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

exec "$@"

