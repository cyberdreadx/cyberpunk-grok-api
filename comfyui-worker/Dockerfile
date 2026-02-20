# GLTCH Edit — ComfyUI RunPod Serverless Worker
# Qwen Image Edit workflow with LoRA support + optional HD upscale.
#
# Build:   docker build -t your-dockerhub-user/comfyui-worker:latest .
# Push:    docker push your-dockerhub-user/comfyui-worker:latest

FROM runpod/worker-comfyui:5.7.1-base

# ── Custom Nodes ─────────────────────────────────────────────────
# QwenEditUtils (TextEncodeQwenImageEditPlus node)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/lrzjason/Comfyui-QwenEditUtils/archive/refs/heads/master.tar.gz | tar xz && \
    mv Comfyui-QwenEditUtils-master Comfyui-QwenEditUtils

# UltimateSDUpscale (HD upscale option)
RUN cd /comfyui/custom_nodes && \
    wget -qO- https://github.com/ssitu/ComfyUI_UltimateSDUpscale/archive/refs/heads/main.tar.gz | tar xz && \
    mv ComfyUI_UltimateSDUpscale-main ComfyUI_UltimateSDUpscale && \
    cd ComfyUI_UltimateSDUpscale/repositories && \
    wget -qO- https://github.com/Coyote-A/ultimate-upscale-for-automatic1111/archive/refs/heads/master.tar.gz | tar xz && \
    mv ultimate-upscale-for-automatic1111-master ultimate_sd_upscale

# ── Python Dependencies ─────────────────────────────────────────
RUN cd /comfyui/custom_nodes/Comfyui-QwenEditUtils && \
    if [ -f requirements.txt ]; then pip install -r requirements.txt --no-cache-dir; fi

# ── Upscale model (baked in — only ~67 MB) ───────────────────────
RUN mkdir -p /comfyui/models/upscale_models && \
    wget -q -O /comfyui/models/upscale_models/4x-UltraSharp.pth \
    https://huggingface.co/Kim2091/UltraSharp/resolve/main/4x-UltraSharp.pth

# ── Network Volume Model Paths ───────────────────────────────────
# Models on RunPod Network Volume (mounted at /runpod-volume):
#   checkpoints/ — Qwen-Rapid-AIO-v1.safetensors (~27 GB)
#   loras/       — Unchained-XXX, qwen-edit-skin, qwen-multiple-angles
RUN printf "\nrunpod_volume:\n    base_path: /runpod-volume/models\n    checkpoints: checkpoints\n    upscale_models: upscale_models\n    vae: vae\n    clip: text_encoders\n    loras: loras\n" >> /comfyui/extra_model_paths.yaml

# ── Patch handler.py to support image output ─────────────────────
COPY handler_patch.py /handler_patch.py
RUN python /handler_patch.py && rm /handler_patch.py
