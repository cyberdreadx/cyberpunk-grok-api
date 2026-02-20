# GLTCH — ComfyUI RunPod Serverless Worker
# Qwen Image Edit + WAN 2.2 I2V GGUF workflows.
#
# Build:   docker build -t your-dockerhub-user/comfyui-worker:latest .
# Push:    docker push your-dockerhub-user/comfyui-worker:latest

FROM runpod/worker-comfyui:5.7.1-base

# ── Custom Nodes ─────────────────────────────────────────────────

# QwenEditUtils (TextEncodeQwenImageEditPlus node)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/lrzjason/Comfyui-QwenEditUtils/archive/refs/heads/master.tar.gz | tar xz && \
    mv Comfyui-QwenEditUtils-master Comfyui-QwenEditUtils

# UltimateSDUpscale (HD upscale for Qwen edit)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/ssitu/ComfyUI_UltimateSDUpscale/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI_UltimateSDUpscale-main ComfyUI_UltimateSDUpscale && \
    cd ComfyUI_UltimateSDUpscale/repositories && \
    rm -rf ultimate_sd_upscale && \
    wget -qO- https://github.com/Coyote-A/ultimate-upscale-for-automatic1111/archive/refs/heads/master.tar.gz | tar xz && \
    mv ultimate-upscale-for-automatic1111-master ultimate_sd_upscale

# ComfyUI-GGUF (UnetLoaderGGUF for WAN GGUF models)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/city96/ComfyUI-GGUF/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-GGUF-main ComfyUI-GGUF

# KJNodes (SageAttention, PatchModelPatcherOrder, ModelPatchTorchSettings,
#   ColorMatch, ImageResizeKJv2, INTConstant)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/kijai/ComfyUI-KJNodes/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-KJNodes-main ComfyUI-KJNodes

# ComfyUI-Easy-Use (easy seed, easy cleanGpuUsed)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/yolain/ComfyUI-Easy-Use/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-Easy-Use-main ComfyUI-Easy-Use

# VideoHelperSuite (VHS_VideoCombine for video output)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-VideoHelperSuite-main ComfyUI-VideoHelperSuite

# Frame Interpolation (RIFE VFI for temporal upscale)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/Fannovel16/ComfyUI-Frame-Interpolation/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-Frame-Interpolation-main ComfyUI-Frame-Interpolation

# Unload Model (free VRAM between sampler stages)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/SeanScripts/ComfyUI-Unload-Model/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-Unload-Model-main ComfyUI-Unload-Model

# ── Build tools for Triton/SageAttention JIT compilation ─────────
# Triton JIT-compiles driver.c (a Python C extension using CUDA driver API)
# at first use. It needs:
#   1. gcc          — C compiler
#   2. python3.12-dev — Python.h headers (driver.c #includes <Python.h>)
#   3. libcuda.so   — created at container start by entrypoint.sh (symlink
#                     to the real libcuda.so.1 bind-mounted by nvidia-docker)
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ python3.12-dev && \
    rm -rf /var/lib/apt/lists/*

# Entrypoint: symlinks libcuda.so from real driver, clears Triton cache
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/start.sh"]

# ── Python Dependencies ─────────────────────────────────────────
RUN pip install --no-cache-dir gguf color-matcher sageattention triton && \
    cd /comfyui/custom_nodes/Comfyui-QwenEditUtils && \
    ([ -f requirements.txt ] && pip install -r requirements.txt --no-cache-dir || true) && \
    cd /comfyui/custom_nodes/ComfyUI-KJNodes && \
    ([ -f requirements.txt ] && pip install -r requirements.txt --no-cache-dir || true) && \
    cd /comfyui/custom_nodes/ComfyUI-Easy-Use && \
    ([ -f requirements.txt ] && pip install -r requirements.txt --no-cache-dir || true) && \
    cd /comfyui/custom_nodes/ComfyUI-VideoHelperSuite && \
    ([ -f requirements.txt ] && pip install -r requirements.txt --no-cache-dir || true) && \
    cd /comfyui/custom_nodes/ComfyUI-Frame-Interpolation && \
    ([ -f requirements.txt ] && pip install -r requirements.txt --no-cache-dir || true)

# ── Bake in small models ─────────────────────────────────────────
# 4x-UltraSharp for Qwen edit upscale (~67 MB)
RUN mkdir -p /comfyui/models/upscale_models && \
    wget -q -O /comfyui/models/upscale_models/4x-UltraSharp.pth \
    https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth

# RIFE model for frame interpolation (~21 MB)
RUN mkdir -p /comfyui/custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife && \
    wget -q -O /comfyui/custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife/rife49.pth \
    https://huggingface.co/hfmaster/models-moved/resolve/main/rife/rife49.pth

# ── Network Volume Model Paths ───────────────────────────────────
# Models on RunPod Network Volume (mounted at /runpod-volume):
#   checkpoints/ — Qwen-Rapid-AIO-v1.safetensors (~27 GB)
#   loras/       — Unchained-XXX, qwen-edit-skin, qwen-multiple-angles
RUN printf "\nrunpod_volume:\n    base_path: /runpod-volume/runpod-slim/ComfyUI/models\n    checkpoints: checkpoints\n    upscale_models: upscale_models\n    vae: vae\n    clip: text_encoders\n    loras: loras\n    unet: unet\n    diffusion_models: diffusion_models\n\nrunpod_volume_unet_compat:\n    base_path: /runpod-volume/runpod-slim/ComfyUI/models\n    diffusion_models: unet\n" >> /comfyui/extra_model_paths.yaml

# ── Force full VRAM mode (H200 141GB — no need for lowvram) ──────
RUN sed -i 's|python -u /comfyui/main.py|python -u /comfyui/main.py --gpu-only|g' /start.sh

# ── Patch handler.py to support image output ─────────────────────
COPY handler_patch.py /handler_patch.py
RUN python /handler_patch.py && rm /handler_patch.py
