# ComfyUI RunPod Serverless Worker
# Lightweight image: custom nodes only, models live on Network Volume.
#
# Build:   docker build -t your-dockerhub-user/comfyui-worker:latest .
# Push:    docker push your-dockerhub-user/comfyui-worker:latest
#
# Or connect this repo to RunPod via GitHub for automatic builds.

FROM runpod/worker-comfyui:latest-base

# ── Custom Nodes ──────────────────────────────────────────────────
# Qwen Image Edit text encoder (TextEncodeQwenImageEditPlus)
RUN cd /comfyui/custom_nodes && \
    git clone https://github.com/Elpatoli/Comfyui-QwenEditUtils

# Easy-Use utilities (easy cleanGpuUsed)
RUN cd /comfyui/custom_nodes && \
    git clone https://github.com/yolain/ComfyUI-Easy-Use

# Ultimate SD Upscale (for HD upscale option)
RUN cd /comfyui/custom_nodes && \
    git clone https://github.com/ssitu/ComfyUI_UltimateSDUpscale

# ── Python Dependencies ──────────────────────────────────────────
RUN cd /comfyui/custom_nodes/Comfyui-QwenEditUtils && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-Easy-Use && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

# ── Network Volume Model Paths ───────────────────────────────────
# Tell ComfyUI to also look for models on the RunPod Network Volume
# (mounted at /runpod-volume). This avoids baking the 10-20GB model
# into the Docker image.
RUN printf "\nrunpod_volume:\n    base_path: /runpod-volume/models\n    checkpoints: checkpoints\n    upscale_models: upscale_models\n" >> /comfyui/extra_model_paths.yaml
