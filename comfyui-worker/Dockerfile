# GLTCH — ComfyUI RunPod Serverless Worker
# Qwen Image Edit + WAN 2.2 I2V GGUF workflows.
#
# Build:   docker build -t your-dockerhub-user/comfyui-worker:latest .
# Push:    docker push your-dockerhub-user/comfyui-worker:latest

FROM runpod/worker-comfyui:5.7.1-base

# ── Custom Nodes (via comfy-cli registry) ────────────────────────
# comfy-node-install uses comfy-cli which handles cloning, deps,
# and installs into the correct venv at /opt/venv.
RUN comfy-node-install \
    comfyui-videohelpersuite \
    comfyui-frame-interpolation \
    comfyui-gguf \
    comfyui-kjnodes \
    comfyui-easy-use

# Nodes not in the registry — manual install
# QwenEditUtils
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

# Unload Model (free VRAM between sampler stages)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/SeanScripts/ComfyUI-Unload-Model/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI-Unload-Model-main ComfyUI-Unload-Model

# ── Build tools for Triton/SageAttention JIT compilation ─────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ python3.12-dev && \
    rm -rf /var/lib/apt/lists/*

# Entrypoint: symlinks libcuda.so from real driver, clears Triton cache
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/start.sh"]

# ── Python Dependencies (use uv to match base image venv) ────────
RUN uv pip install gguf color-matcher sageattention triton && \
    cd /comfyui/custom_nodes/Comfyui-QwenEditUtils && \
    ([ -f requirements.txt ] && uv pip install -r requirements.txt || true)

# ── Bake in small models ─────────────────────────────────────────
# 4x-UltraSharp for Qwen edit upscale (~67 MB)
# RealESRGAN_x2plus for video upscale (~67 MB)
RUN mkdir -p /comfyui/models/upscale_models && \
    wget -q -O /comfyui/models/upscale_models/4x-UltraSharp.pth \
    https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth && \
    wget -q -O /comfyui/models/upscale_models/RealESRGAN_x2plus.pth \
    https://huggingface.co/xingren23/comfyflow-models/resolve/main/upscale_models/RealESRGAN_x2plus.pth

# RIFE model for frame interpolation (~21 MB)
RUN mkdir -p /comfyui/custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife && \
    wget -q -O /comfyui/custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife/rife49.pth \
    https://huggingface.co/hfmaster/models-moved/resolve/main/rife/rife49.pth

# ── Network Volume Model Paths ───────────────────────────────────
RUN printf "\nrunpod_volume:\n    base_path: /runpod-volume/runpod-slim/ComfyUI/models\n    checkpoints: checkpoints\n    upscale_models: upscale_models\n    vae: vae\n    clip: text_encoders\n    loras: loras\n    unet: unet\n    diffusion_models: diffusion_models\n\nrunpod_volume_unet_compat:\n    base_path: /runpod-volume/runpod-slim/ComfyUI/models\n    diffusion_models: unet\n" >> /comfyui/extra_model_paths.yaml

# ── Force full VRAM mode (H200 141GB — no need for lowvram) ──────
RUN sed -i 's|python -u /comfyui/main.py|python -u /comfyui/main.py --gpu-only|g' /start.sh

# ── Patch handler.py to support image output ─────────────────────
COPY handler_patch.py /handler_patch.py
RUN python /handler_patch.py && rm /handler_patch.py

# ── Patch rp_upload.py to read BUCKET_NAME from env ─────────────
COPY bucket_patch.py /bucket_patch.py
RUN python /bucket_patch.py && rm /bucket_patch.py

# ── Patch handler.py to clean up after each job ─────────────────
COPY cleanup_patch.py /cleanup_patch.py
RUN python /cleanup_patch.py && rm /cleanup_patch.py
