# GLTCH — ComfyUI RunPod Serverless Worker
# WAN 2.2 I2V GGUF video workflows.
# Uses GACLove/ComfyUI-VFI for GPU-accelerated RIFE frame interpolation.
# Flux 2 Klein image edits run on the separate zimage endpoint.
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

# Frame Interpolation (GPU-accelerated RIFE via ComfyUI-VFI)
# Patch warplayer.py: use tensor device instead of module-level device var
# (module-level torch.cuda.is_available() can be false at import time in RunPod)
RUN git clone https://github.com/GACLove/ComfyUI-VFI.git && \
    cd ComfyUI-VFI && \
    uv pip install -r requirements.txt && \
    sed -i 's/device=device/device=tenFlow.device/g' rife/model/warplayer.py && \
    sed -i 's/\.to(device)/.to(tenFlow.device)/g' rife/model/warplayer.py && \
    sed -i 's/output_frames.append(images\[source_idx1\])/output_frames.append(images[source_idx1].cpu())/' rife/rife_comfyui_wrapper.py

# KJNodes (SageAttention, PatchModelPatcherOrder, etc.)
RUN git clone https://github.com/kijai/ComfyUI-KJNodes.git && \
    cd ComfyUI-KJNodes && \
    ([ -f requirements.txt ] && uv pip install -r requirements.txt || true)

# ComfyUI-Easy-Use (easy seed, easy cleanGpuUsed)
RUN git clone https://github.com/yolain/ComfyUI-Easy-Use.git && \
    cd ComfyUI-Easy-Use && \
    ([ -f requirements.txt ] && uv pip install -r requirements.txt || true)

# UltimateSDUpscale (HD upscale)
RUN git clone https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git && \
    cd ComfyUI_UltimateSDUpscale/repositories && \
    rm -rf ultimate_sd_upscale && \
    git clone https://github.com/Coyote-A/ultimate-upscale-for-automatic1111.git ultimate_sd_upscale

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
    assert __import__('os').path.isfile('/comfyui/custom_nodes/ComfyUI-VFI/__init__.py'), 'ComfyUI-VFI missing'; \
    print('All critical custom nodes verified OK')"

# ── Bake in small models ─────────────────────────────────────────
RUN mkdir -p /comfyui/models/upscale_models && \
    wget -q -O /comfyui/models/upscale_models/4x-UltraSharp.pth \
    https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth && \
    wget -q -O /comfyui/models/upscale_models/RealESRGAN_x2plus.pth \
    https://huggingface.co/xingren23/comfyflow-models/resolve/main/upscale_models/RealESRGAN_x2plus.pth

# RIFE model for frame interpolation (~12 MB)
RUN mkdir -p /comfyui/custom_nodes/ComfyUI-VFI/rife/train_log && \
    wget -q -O /comfyui/custom_nodes/ComfyUI-VFI/rife/train_log/flownet.pkl \
    https://huggingface.co/jbilcke-hf/varnish/resolve/main/rife/flownet.pkl

# CLIPVision for WAN 2.2 I2V conditioning (~3.9 GB)
RUN mkdir -p /comfyui/models/clip_vision && \
    wget -q -O /comfyui/models/clip_vision/clip_vision_h.safetensors \
    https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/clip_vision/clip_vision_h.safetensors

# ── Network Volume Model Paths ───────────────────────────────────
RUN printf "\nrunpod_volume:\n    base_path: /runpod-volume/runpod-slim/ComfyUI/models\n    checkpoints: checkpoints\n    upscale_models: upscale_models\n    vae: vae\n    clip: text_encoders\n    clip_vision: clip_vision\n    loras: loras\n    unet: unet\n    diffusion_models: diffusion_models\n\nrunpod_volume_unet_compat:\n    base_path: /runpod-volume/runpod-slim/ComfyUI/models\n    diffusion_models: unet\n" >> /comfyui/extra_model_paths.yaml

# ── Force GPU-only mode (H200 141GB — disable all VRAM management) ──
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
