#!/bin/bash
# Vast.ai boot (runs after /entrypoint.sh): fetch models, then start ComfyUI +
# the GLTCH agent instead of the RunPod handler. See vast_agent.py.
set -e
mkdir -p /runpod-volume/runpod-slim/ComfyUI/models
python -u /vast_agent.py --download
sed -i 's#/handler.py#/vast_agent.py#g' /start.sh
exec /start.sh
