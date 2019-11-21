#!/bin/bash

# include the demo magic
. ./demo/demo-magic.sh
clear

pe "kind create cluster"
pe 'export KUBECONFIG="$(kind get kubeconfig-path --name="kind")"'

wait

pe "kubectl apply -f deploy/crd.yaml"

wait

pe "kubectl apply -f examples/rbac.yaml"
pe "kubectl apply -f examples/configmap.yaml"
pe "kubectl apply -f examples/deployment.yaml"

pe "open http://localhost:3000"
pe "kubectl port-forward deploy/grafana 3000"