#!/bin/bash
# GLTCH ComfyUI Worker — entrypoint
# Runs before start.sh to fix CUDA linking and auto-download models.

# ── CUDA symlink for Triton/SageAttention JIT ────────────────────
# nvidia-docker bind-mounts the real libcuda.so.1 at container start.
# Triton's JIT compiler (gcc) needs libcuda.so (unversioned) for -lcuda.
for dir in /usr/lib/x86_64-linux-gnu /usr/local/nvidia/lib64 /usr/local/cuda/lib64; do
  if [ -f "$dir/libcuda.so.1" ]; then
    ln -sf "$dir/libcuda.so.1" "$dir/libcuda.so"
    echo "entrypoint: linked $dir/libcuda.so -> $dir/libcuda.so.1"
    break
  fi
done

rm -rf /root/.triton/cache 2>/dev/null

# ── Auto-download missing models from CivitAI ───────────────────
# Downloads to network volume so they persist across cold starts.
# Requires CIVITAI_API_TOKEN env var on the serverless endpoint.
LORA_DIR="/workspace/runpod-slim/ComfyUI/models/loras"
FALLBACK_LORA_DIR="/comfyui/models/loras"

if [ -d "$LORA_DIR" ]; then
  TARGET_DIR="$LORA_DIR"
elif [ -d "$FALLBACK_LORA_DIR" ]; then
  TARGET_DIR="$FALLBACK_LORA_DIR"
else
  TARGET_DIR=""
fi

download_civitai() {
  local filename="$1"
  local version_id="$2"
  local desc="$3"

  if [ -z "$TARGET_DIR" ]; then
    echo "entrypoint: skip $desc — no lora directory found"
    return
  fi
  if [ -f "$TARGET_DIR/$filename" ]; then
    echo "entrypoint: $desc already exists, skipping"
    return
  fi
  if [ -z "$CIVITAI_API_TOKEN" ]; then
    echo "entrypoint: skip $desc — CIVITAI_API_TOKEN not set"
    return
  fi

  echo "entrypoint: downloading $desc..."
  wget -q --show-progress -O "$TARGET_DIR/$filename" \
    "https://civitai.com/api/download/models/${version_id}?token=${CIVITAI_API_TOKEN}" \
    && echo "entrypoint: $desc downloaded" \
    || echo "entrypoint: WARN — failed to download $desc"
}

download_civitai "wan_i2v_pov_blowjob_v1.2.safetensors" "2021249" "Wan POV Blowjob v1.2 I2V LoRA"
download_civitai "genitals_helper_v1.0_e219.safetensors" "2012120" "NSFW Genitals Helper v1.0 I2V LoRA"
download_civitai "mystic_xxx_wan22_i2v_high_v1.safetensors" "2435942" "Mystic XXX Wan 2.2 I2V High v1 LoRA"

# ── Auto-download MMAudio models to network volume ───────────────
MMAUDIO_DIR="/workspace/runpod-slim/ComfyUI/models/mmaudio"
FALLBACK_MMAUDIO_DIR="/comfyui/models/mmaudio"

if [ -d "/workspace/runpod-slim/ComfyUI/models" ]; then
  MMAUDIO_TARGET="$MMAUDIO_DIR"
else
  MMAUDIO_TARGET="$FALLBACK_MMAUDIO_DIR"
fi
mkdir -p "$MMAUDIO_TARGET"

download_hf() {
  local filename="$1"
  local url="$2"
  local desc="$3"
  local target_dir="$4"

  if [ -f "$target_dir/$filename" ]; then
    echo "entrypoint: $desc already exists, skipping"
    return
  fi

  echo "entrypoint: downloading $desc..."
  wget -q --show-progress -O "$target_dir/$filename" "$url" \
    && echo "entrypoint: $desc downloaded" \
    || echo "entrypoint: WARN — failed to download $desc"
}

download_hf "mmaudio_large_44k_v2_fp16.safetensors" \
  "https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_large_44k_v2_fp16.safetensors" \
  "MMAudio Large 44k v2 FP16" "$MMAUDIO_TARGET"

download_hf "mmaudio_synchformer_fp16.safetensors" \
  "https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_synchformer_fp16.safetensors" \
  "MMAudio Synchformer FP16" "$MMAUDIO_TARGET"

download_hf "mmaudio_vae_44k_fp16.safetensors" \
  "https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/mmaudio_vae_44k_fp16.safetensors" \
  "MMAudio VAE 44k FP16" "$MMAUDIO_TARGET"

download_hf "apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors" \
  "https://huggingface.co/Kijai/MMAudio_safetensors/resolve/main/apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors" \
  "MMAudio CLIP (Apple DFN5B)" "$MMAUDIO_TARGET"

# ── Auto-download F5-TTS model ───────────────────────────────────
F5TTS_DIR="/workspace/runpod-slim/ComfyUI/models/F5-TTS"
FALLBACK_F5TTS_DIR="/comfyui/models/F5-TTS"

if [ -d "/workspace/runpod-slim/ComfyUI/models" ]; then
  F5TTS_TARGET="$F5TTS_DIR"
else
  F5TTS_TARGET="$FALLBACK_F5TTS_DIR"
fi
mkdir -p "$F5TTS_TARGET"

download_hf "F5TTS_v1_Base.safetensors" \
  "https://huggingface.co/SWivid/F5-TTS/resolve/main/F5TTS_v1_Base/model_1250000.safetensors" \
  "F5-TTS v1 Base Model" "$F5TTS_TARGET"

exec "$@"

