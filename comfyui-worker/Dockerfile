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

# ComfyUI-MediaMixer (FinalFrameSelector for LongLook multi-clip continuation)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/DoctorDiffusion/ComfyUI-MediaMixer/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-MediaMixer-main ComfyUI-MediaMixer

# comfyUI-LongLook (WanFreeLong, WanMotionScale, WanContinuationConditioning)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/shootthesound/comfyUI-LongLook/archive/refs/heads/main.tar.gz | tar xz && \
    mv comfyUI-LongLook-main comfyUI-LongLook

# ComfyUI-PainterI2Vadvanced (PainterI2VAdvanced — drop-in WanImageToVideo replacement
# that fixes color drift at high motion, splits conditioning into high/low pairs)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/princepainter/ComfyUI-PainterI2Vadvanced/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-PainterI2Vadvanced-main ComfyUI-PainterI2Vadvanced

# comfyui-vrgamedevgirl (FastUnsharpSharpen for post-process video sharpening)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/vrgamegirl19/comfyui-vrgamedevgirl/archive/refs/heads/main.tar.gz | tar xz && \
    mv comfyui-vrgamedevgirl-main comfyui-vrgamedevgirl

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

RUN cd /comfyui/custom_nodes/ComfyUI-MediaMixer && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/ComfyUI-PainterI2Vadvanced && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

RUN cd /comfyui/custom_nodes/comfyui-vrgamedevgirl && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

# ── Upscale model (baked in — only ~67 MB) ───────────────────────
RUN mkdir -p /comfyui/models/upscale_models && \
    wget -q -O /comfyui/models/upscale_models/4x-UltraSharp.pth \
    https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth

# ── Network Volume Model Paths ───────────────────────────────────
# Tell ComfyUI to also look for models on the RunPod Network Volume
# (mounted at /runpod-volume). This avoids baking the 10-20GB model
# into the Docker image.
RUN printf "\nrunpod_volume:\n    base_path: /runpod-volume/models\n    checkpoints: checkpoints\n    diffusion_models: diffusion_models\n    upscale_models: upscale_models\n    vae: vae\n    clip: text_encoders\n    loras: loras\n    unet: unet\n    gguf: gguf\n" >> /comfyui/extra_model_paths.yaml

# ── Optional highvram mode via env var ─────────────────────────────
# Set COMFY_EXTRA_FLAGS=--highvram on endpoints with 48GB+ VRAM.
# The base start.sh doesn't support extra args, so we patch it to
# read from the COMFY_EXTRA_FLAGS environment variable at runtime.
RUN sed -i 's|python -u /comfyui/main.py --disable-auto-launch --disable-metadata|python -u /comfyui/main.py --disable-auto-launch --disable-metadata ${COMFY_EXTRA_FLAGS}|g' /start.sh

# ── Patch handler.py to support video output (gifs/videos keys) ──
# The base handler only processes "images" in node output, but
# VHS_VideoCombine outputs under "gifs". This patch adds handling
# for gifs and videos output keys so they get uploaded to S3 or
# returned as base64 just like images.
COPY handler_patch.py /handler_patch.py
RUN python /handler_patch.py && rm /handler_patch.py
