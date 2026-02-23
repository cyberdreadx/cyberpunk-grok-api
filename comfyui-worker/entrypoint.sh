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

# ── Clean stale job output from network volume ─────────────────
# RunPod SDK leaves {job_id}-u{N} staging dirs in /workspace after
# uploading to S3. Remove them on every worker start.
WORKSPACE="/workspace"
if [ -d "$WORKSPACE" ]; then
  count=$(find "$WORKSPACE" -maxdepth 1 -mindepth 1 -type d -regextype posix-extended \
    -regex '.*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-u[0-9]+' 2>/dev/null | wc -l)
  if [ "$count" -gt 0 ]; then
    find "$WORKSPACE" -maxdepth 1 -mindepth 1 -type d -regextype posix-extended \
      -regex '.*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-u[0-9]+' \
      -exec rm -rf {} + 2>/dev/null
    echo "entrypoint: removed $count stale job dirs from $WORKSPACE"
  fi
fi

# Clean accumulated ComfyUI output files
rm -rf /comfyui/output/*.png /comfyui/output/*.jpg 2>/dev/null
rm -rf /comfyui/output/video/* /comfyui/output/wan2-2/* 2>/dev/null
echo "entrypoint: cleared ComfyUI output cache"

exec "$@"

