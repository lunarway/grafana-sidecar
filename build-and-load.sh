#!/bin/bash

docker build . -t grafana-sidecar:v1.0.0
kind load docker-image grafana-sidecar:v1.0.0