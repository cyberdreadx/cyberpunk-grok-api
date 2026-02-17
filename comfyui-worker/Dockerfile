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

# ComfyUI-GGUF (UnetLoaderGGUF for GGUF-quantized models)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/city96/ComfyUI-GGUF/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-GGUF-main ComfyUI-GGUF

# ComfyUI-VideoHelperSuite (VHS_VideoCombine for video encoding)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-VideoHelperSuite-main ComfyUI-VideoHelperSuite

# ComfyUI-KJNodes (ImageResizeKJ, FinalFrameSelector)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/kijai/ComfyUI-KJNodes/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-KJNodes-main ComfyUI-KJNodes

# ComfyUI-Crystools (Switch any)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/crystian/ComfyUI-Crystools/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-Crystools-main ComfyUI-Crystools

# rgthree-comfy (Fast Bypasser)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/rgthree/rgthree-comfy/archive/refs/heads/main.tar.gz | tar xz && \
    mv rgthree-comfy-main rgthree-comfy

# ── Python Dependencies ──────────────────────────────────────────
RUN cd /comfyui/custom_nodes/Comfyui-QwenEditUtils && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-Easy-Use && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-Frame-Interpolation && \
    pip install -r requirements-no-cupy.txt --no-cache-dir

RUN cd /comfyui/custom_nodes/ComfyUI-GGUF && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-VideoHelperSuite && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-KJNodes && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-Crystools && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/rgthree-comfy && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

# ── Network Volume Model Paths ───────────────────────────────────
# Tell ComfyUI to also look for models on the RunPod Network Volume
# (mounted at /runpod-volume). This avoids baking the 10-20GB model
# into the Docker image.
RUN printf "\nrunpod_volume:\n    base_path: /runpod-volume/models\n    checkpoints: checkpoints\n    diffusion_models: diffusion_models\n    upscale_models: upscale_models\n    vae: vae\n    clip: text_encoders\n    loras: loras\n    unet: unet\n    gguf: gguf\n" >> /comfyui/extra_model_paths.yaml
