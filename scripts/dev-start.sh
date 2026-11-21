#!/bin/bash
cd /workspace/azolve
source scripts/dev-env.sh
export DATA_DIR=${DATA_DIR:-/workspace/azolve/.devdata}
mkdir -p "$DATA_DIR"
exec node server/index.js
