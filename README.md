# grafana-sidecar

A small sidecar to provision Grafana Dashboards using Kubernetes CRDs

## Wait... what does it do?

This introduces:

- a Custom Resource Definition
- a sidecar to your already existing Grafana deployment
  And with this the grafana-sidecar will give you full support for Grafana Dashboards defined as Custom Resources in Kubernetes.

## Show me

- Start you favorite kubernetes cluster. Fx kind:

```bash
kind start cluster
```

- Add the CRD

```bash
kubectl apply -f deploy/crd.yaml
```

- Deploy the example

```bash
kubectl apply -f examples/
```
