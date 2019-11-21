const { Client, KubeConfig } = require('kubernetes-client')
const Request = require('kubernetes-client/backends/request')
const JSONStream = require('json-stream')
const yaml = require('js-yaml')
const fs = require('fs')
const slugify = require('slugify')
const path = require('path')
const bunyan = require('bunyan')
const yargs = require('yargs')
const axios = require('axios')

const log = bunyan.createLogger({ name: 'grafana-sidecar' })

/* TODO:
- Read command line arguments
  - path to grafana
  - path to provider file
  - path to dashboards
  - grafana server for API
  - grafana API key / basic auth
- make grafana update providers using API
*/

async function main(settings) {
  while (true) {
    try {
      log.info('Starting grafana-sidecar')
      // const kubeconfig = new KubeConfig()
      // kubeconfig.loadFromCluster()
      // const backend = new Request({ kubeconfig })
      // const client = new Client({ backend })
      const backend = new Request(Request.config.getInCluster())
      const client = new Client({ backend })
      await client.loadSpec()

      // Add endpoints to our client
      const crd = yaml.safeLoad(fs.readFileSync('./deploy/crd.yaml', 'utf8'))
      client.addCustomResourceDefinition(crd)

      const allDashboardsRequest = await client.apis[
        'lunarway.com'
      ].v1alpha1.grafanadashboards.get()
      const allDashboards = allDashboardsRequest.body.items.reduce(
        (result, dashboard) => {
          result[
            `${dashboard.metadata.namespace}#${dashboard.metadata.name}`
          ] = dashboard
          return result
        },
        {}
      )

      await Promise.all(
        Object.values(allDashboards).map(d =>
          updateDashboardConfig(d, settings)
        )
      )
      await updateProviderConfig(allDashboards, settings)
      await reloadProviderConfig(settings)

      const stream = await client.apis[
        'lunarway.com'
      ].v1alpha1.watch.grafanadashboards.getObjectStream()

      await new Promise(a =>
        stream
          .on('data', async event => {
            try {
              if (event.type === 'ADDED' || event.type === 'MODIFIED') {
                const dashboard = event.object
                allDashboards[
                  `${dashboard.metadata.namespace}#${dashboard.metadata.name}`
                ] = dashboard
                await updateDashboardConfig(dashboard, settings)
                await updateProviderConfig(allDashboards, settings)
                await reloadProviderConfig(settings)
                return
              } else if (event.type === 'DELETED') {
                const dashboard = event.object
                delete allDashboards[
                  `${dashboard.metadata.namespace}#${dashboard.metadata.name}`
                ]
                await deleteDashboardConfig(dashboard, settings)
                log.info(
                  'wait more than 10s to delete provider, so grafana can cleanup first'
                )
                await new Promise(a => setTimeout(a, 11000))
                await updateProviderConfig(allDashboards, settings)
                await reloadProviderConfig(settings)
                return
              }

              log.info({ event }, 'got unhandled event from watcher')
            } catch (err) {
              log.error(err, 'got unhandled error in event watcher')
            }
          })
          .on('end', () => {
            a()
          })
      )
    } catch (err) {
      log.error(err, 'got unhandled error in main loop')
      await new Promise(a => setTimeout(a, 5000))
      log.info(err, 'restarting main loop')
    }
  }
}

async function updateProviderConfig(allDashboards, settings) {
  const providers = Object.values(allDashboards).reduce(
    (providers, dashboard) => {
      const folderData = getFolderData(dashboard.spec.folderTitle, settings)
      providers[folderData.grafanaUid] = {
        name: folderData.folderTitle,
        orgId: 1,
        folder: folderData.grafanaFolder,
        folderUid: folderData.grafanaUid,
        type: 'file',
        updateIntervalSeconds: 10,
        options: {
          path: folderData.folderPath,
        },
      }
      return providers
    },
    {}
  )

  fs.mkdirSync(path.dirname(settings.providerPath), { recursive: true })
  fs.writeFileSync(
    settings.providerPath,
    yaml.dump({
      apiVersion: 1,
      providers: Object.values(providers),
    })
  )

  log.info('updated provider at %s', settings.providerPath)
}

async function reloadProviderConfig(settings) {
  const req = {
    baseURL: settings.grafanaApi,
    url: '/api/admin/provisioning/dashboards/reload',
    method: 'POST',
  }
  if (settings.grafanaAuth.type === 'basic') {
    req.auth = {
      username: settings.grafanaAuth.username,
      password: settings.grafanaAuth.password,
    }
  } else if (settings.grafanaAuth.type === 'token') {
    req.headers = { Authorization: `Bearer ${settings.grafanaAuth.token}` }
  } else {
    // nothing
  }
  try {
    await axios.request(req)
  } catch (err) {
    log.error(err, 'failed reloading providers')
    return
  }

  log.info('reloaded providers')
}

async function updateDashboardConfig(dashboard, settings) {
  const dashboardFolderData = getFolderData(
    dashboard.spec.folderTitle,
    settings
  )
  const dashboardPath = path.join(
    dashboardFolderData.folderPath,
    `${dashboard.metadata.namespace}_${dashboard.metadata.name}.json`
  )
  fs.mkdirSync(path.dirname(dashboardPath), { recursive: true })
  fs.writeFileSync(dashboardPath, dashboard.spec.json)

  log.info('updated dashboard at %s', dashboardPath)
}
async function deleteDashboardConfig(dashboard, settings) {
  const dashboardFolderData = getFolderData(
    dashboard.spec.folderTitle,
    settings
  )
  const dashboardPath = path.join(
    dashboardFolderData.folderPath,
    `${dashboard.metadata.namespace}_${dashboard.metadata.name}.json`
  )
  fs.unlinkSync(dashboardPath)

  log.info('deleted dashboard at %s', dashboardPath)
}

function getFolderData(folderTitle, settings) {
  return {
    folderTitle: folderTitle,
    grafanaFolder:
      folderTitle === 'General' || folderTitle == '' ? '' : folderTitle,
    grafanaUid:
      folderTitle === 'General' || folderTitle == ''
        ? ''
        : slugify(folderTitle).substring(0, 40),
    folderPath: `${settings.dashboardDir}/${slugify(folderTitle)}`,
  }
}

function startFromArgs() {
  yargs
    .command(
      'watch [port]',
      'watch for grafana dashboard custom resources',
      yargs => {
        yargs
          .option('grafana-dir', {
            describe: 'the directory to use for output files',
            default: '/etc/grafana',
          })
          .option('dashboard-dir', {
            describe: '',
            default: 'dashboards',
          })
          .option('provider-path', {
            describe: '',
            default: 'provisioning/dashboards/provider.yaml',
          })
          .option('grafana-api', {
            describe: 'the URL to the grafana API',
            default: 'http://localhost:3000',
          })
          .option('grafana-basic-auth', {
            describe: 'use grafana basic auth for API calls',
            default: '',
          })
          .option('grafana-token-auth', {
            describe: 'use grafana token for API calls',
            default: '',
          })
      },
      argv => {
        if (argv.verbose) {
          log.level(bunyan.DEBUG)
        }
        log.debug(`start watching kubernetes API`)
        //serve(argv.port)
        main({
          grafanaDir: argv['grafana-dir'],
          dashboardDir: path.join(argv['grafana-dir'], argv['dashboard-dir']),
          providerPath: path.join(argv['grafana-dir'], argv['provider-path']),
          grafanaApi: argv['grafana-api'],
          grafanaAuth: argv['grafana-token-auth']
            ? { type: 'token', token: argv['grafana-token-auth'] }
            : argv['grafana-basic-auth']
            ? {
                type: 'basic',
                username: argv['grafana-basic-auth'].split(':')[0],
                password: argv['grafana-basic-auth'].split(':')[1],
              }
            : { type: 'anonymous' },
        })
      }
    )
    .option('verbose', {
      alias: 'v',
      type: 'boolean',
      description: 'Run with verbose logging',
    })
    .demandCommand().argv
}

startFromArgs()
