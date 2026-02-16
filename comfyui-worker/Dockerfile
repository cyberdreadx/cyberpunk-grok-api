# ComfyUI RunPod Serverless Worker
# Lightweight image: custom nodes only, models live on Network Volume.
#
# Build:   docker build -t your-dockerhub-user/comfyui-worker:latest .
# Push:    docker push your-dockerhub-user/comfyui-worker:latest
#
# Or connect this repo to RunPod via GitHub for automatic builds.

FROM runpod/worker-comfyui:5.7.1-base

# ── Custom Nodes (zip download — more reliable than git in build env) ─
RUN cd /comfyui/custom_nodes && \
    wget -q -O QwenEditUtils.zip https://github.com/Elpatoli/Comfyui-QwenEditUtils/archive/refs/heads/main.zip && \
    unzip -q QwenEditUtils.zip && mv Comfyui-QwenEditUtils-main Comfyui-QwenEditUtils && rm QwenEditUtils.zip

RUN cd /comfyui/custom_nodes && \
    wget -q -O EasyUse.zip https://github.com/yolain/ComfyUI-Easy-Use/archive/refs/heads/main.zip && \
    unzip -q EasyUse.zip && mv ComfyUI-Easy-Use-main ComfyUI-Easy-Use && rm EasyUse.zip

RUN cd /comfyui/custom_nodes && \
    wget -q -O UltimateSDUpscale.zip https://github.com/ssitu/ComfyUI_UltimateSDUpscale/archive/refs/heads/master.zip && \
    unzip -q UltimateSDUpscale.zip && mv ComfyUI_UltimateSDUpscale-master ComfyUI_UltimateSDUpscale && rm UltimateSDUpscale.zip

# ── Python Dependencies ──────────────────────────────────────────
RUN cd /comfyui/custom_nodes/Comfyui-QwenEditUtils && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-Easy-Use && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

# ── Network Volume Model Paths ───────────────────────────────────
# Tell ComfyUI to also look for models on the RunPod Network Volume
# (mounted at /runpod-volume). This avoids baking the 10-20GB model
# into the Docker image.
RUN printf "\nrunpod_volume:\n    base_path: /runpod-volume/models\n    checkpoints: checkpoints\n    diffusion_models: diffusion_models\n    upscale_models: upscale_models\n    vae: vae\n    clip: text_encoders\n    loras: loras\n    unet: unet\n" >> /comfyui/extra_model_paths.yaml
