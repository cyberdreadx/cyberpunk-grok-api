# GLTCH — ComfyUI RunPod Serverless Worker
# Qwen Image Edit + WAN 2.2 I2V GGUF workflows.
#
# Build:   docker build -t your-dockerhub-user/comfyui-worker:latest .
# Push:    docker push your-dockerhub-user/comfyui-worker:latest

FROM runpod/worker-comfyui:5.7.1-base

# ── Custom Nodes (git clone → uv pip install into /opt/venv) ─────
# IMPORTANT: base image uses a Python venv at /opt/venv via uv.
# All pip installs MUST use `uv pip install` to target the correct env.

WORKDIR /comfyui/custom_nodes

# VideoHelperSuite (VHS_VideoCombine — video output)
RUN git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git && \
    cd ComfyUI-VideoHelperSuite && \
    uv pip install -r requirements.txt

# ComfyUI-GGUF (UnetLoaderGGUF for WAN GGUF models)
RUN git clone https://github.com/city96/ComfyUI-GGUF.git && \
    cd ComfyUI-GGUF && \
    uv pip install -r requirements.txt

# Frame Interpolation (RIFE VFI for temporal upscale)
RUN git clone https://github.com/Fannovel16/ComfyUI-Frame-Interpolation.git && \
    cd ComfyUI-Frame-Interpolation && \
    uv pip install -r requirements-no-cupy.txt

# KJNodes (SageAttention, PatchModelPatcherOrder, etc.)
RUN git clone https://github.com/kijai/ComfyUI-KJNodes.git && \
    cd ComfyUI-KJNodes && \
    ([ -f requirements.txt ] && uv pip install -r requirements.txt || true)

# ComfyUI-Easy-Use (easy seed, easy cleanGpuUsed)
RUN git clone https://github.com/yolain/ComfyUI-Easy-Use.git && \
    cd ComfyUI-Easy-Use && \
    ([ -f requirements.txt ] && uv pip install -r requirements.txt || true)

# QwenEditUtils (TextEncodeQwenImageEditPlus node)
RUN git clone https://github.com/lrzjason/Comfyui-QwenEditUtils.git && \
    ([ -f Comfyui-QwenEditUtils/requirements.txt ] && cd Comfyui-QwenEditUtils && uv pip install -r requirements.txt || true)

# UltimateSDUpscale (HD upscale for Qwen edit)
RUN git clone https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git && \
    cd ComfyUI_UltimateSDUpscale/repositories && \
    rm -rf ultimate_sd_upscale && \
    git clone https://github.com/Coyote-A/ultimate-upscale-for-automatic1111.git ultimate_sd_upscale

# Unload Model (free VRAM between sampler stages)
RUN git clone https://github.com/SeanScripts/ComfyUI-Unload-Model.git

WORKDIR /

# ── Build tools for Triton/SageAttention JIT compilation ─────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc g++ python3.12-dev && \
    rm -rf /var/lib/apt/lists/*

# Entrypoint: symlinks libcuda.so from real driver, clears Triton cache
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/start.sh"]

# ── Extra Python Dependencies ────────────────────────────────────
RUN uv pip install gguf color-matcher sageattention triton

# ── Verify critical nodes exist at build time ────────────────────
RUN python -c "import sys; sys.path.insert(0,'/comfyui'); \
    assert __import__('os').path.isfile('/comfyui/custom_nodes/ComfyUI-VideoHelperSuite/__init__.py'), 'VHS missing'; \
    assert __import__('os').path.isfile('/comfyui/custom_nodes/ComfyUI-GGUF/__init__.py'), 'GGUF missing'; \
    assert __import__('os').path.isfile('/comfyui/custom_nodes/ComfyUI-Frame-Interpolation/__init__.py'), 'Frame-Interp missing'; \
    print('All critical custom nodes verified OK')"

# ── Bake in small models ─────────────────────────────────────────
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
