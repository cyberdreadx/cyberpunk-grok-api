# ComfyUI RunPod Serverless Worker
# Lightweight image: custom nodes only, models live on Network Volume.
#
# Build:   docker build -t your-dockerhub-user/comfyui-worker:latest .
# Push:    docker push your-dockerhub-user/comfyui-worker:latest
#
# Or connect this repo to RunPod via GitHub for automatic builds.

FROM runpod/worker-comfyui:5.7.1-base

# ── Custom Nodes (tarball download — no git/unzip needed) ────────
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/lrzjason/Comfyui-QwenEditUtils/archive/refs/heads/master.tar.gz | tar xz && \
    mv Comfyui-QwenEditUtils-master Comfyui-QwenEditUtils

RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/yolain/ComfyUI-Easy-Use/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-Easy-Use-main ComfyUI-Easy-Use

RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/ssitu/ComfyUI_UltimateSDUpscale/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI_UltimateSDUpscale-main ComfyUI_UltimateSDUpscale && \
    cd ComfyUI_UltimateSDUpscale/repositories && \
    wget -qO- https://github.com/Coyote-A/ultimate-upscale-for-automatic1111/archive/refs/heads/master.tar.gz | tar xz && \
    mv ultimate-upscale-for-automatic1111-master ultimate_sd_upscale

# RIFE frame interpolation (RIFE VFI node for wan-video)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/Fannovel16/ComfyUI-Frame-Interpolation/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-Frame-Interpolation-main ComfyUI-Frame-Interpolation

# ── Python Dependencies ──────────────────────────────────────────
RUN cd /comfyui/custom_nodes/Comfyui-QwenEditUtils && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-Easy-Use && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-Frame-Interpolation && \
    pip install -r requirements-no-cupy.txt --no-cache-dir

# ── Network Volume Model Paths ───────────────────────────────────
# Tell ComfyUI to also look for models on the RunPod Network Volume
# (mounted at /runpod-volume). This avoids baking the 10-20GB model
# into the Docker image.
RUN printf "\nrunpod_volume:\n    base_path: /runpod-volume/models\n    checkpoints: checkpoints\n    diffusion_models: diffusion_models\n    upscale_models: upscale_models\n    vae: vae\n    clip: text_encoders\n    loras: loras\n    unet: unet\n" >> /comfyui/extra_model_paths.yaml
