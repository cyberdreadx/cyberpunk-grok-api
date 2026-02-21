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

exec "$@"

