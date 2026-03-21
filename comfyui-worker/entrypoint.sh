#!/bin/bash
# GLTCH ComfyUI Worker — entrypoint
# Runs before start.sh. Keeps it simple: symlink, patch, go.

set -e

VOLUME="/workspace/runpod-slim/ComfyUI"

# ── CUDA symlink for Triton/SageAttention JIT ────────────────────
for dir in /usr/lib/x86_64-linux-gnu /usr/local/nvidia/lib64 /usr/local/cuda/lib64; do
  if [ -f "$dir/libcuda.so.1" ]; then
    ln -sf "$dir/libcuda.so.1" "$dir/libcuda.so"
    echo "entrypoint: linked $dir/libcuda.so"
    break
  fi
done
rm -rf /root/.triton/cache 2>/dev/null

# ── Ensure /runpod-volume resolves to the network volume ─────────
if [ ! -e "/runpod-volume" ] && [ -d "$VOLUME" ]; then
  ln -sf "$VOLUME" /runpod-volume
  echo "entrypoint: /runpod-volume -> $VOLUME"
fi

# ── Symlink model dirs from network volume into container ────────
# Models live on the 500GB network volume, NOT the 5GB container overlay.
if [ -d "$VOLUME/models" ]; then
  for subdir in unet loras checkpoints clip clip_vision vae controlnet upscale_models configs; do
    vol_path="$VOLUME/models/$subdir"
    container_path="/comfyui/models/$subdir"
    if [ -d "$vol_path" ] && [ ! -L "$container_path" ]; then
      rm -rf "$container_path" 2>/dev/null
      ln -sf "$vol_path" "$container_path"
    fi
  done
  echo "entrypoint: model dirs symlinked from network volume"
fi

# ── Ensure RealESRGAN_x2plus.pth exists (LongLook + HD upscale) ───
UPSCALE_DIR="/comfyui/models/upscale_models"
UPSCALE_MODEL="RealESRGAN_x2plus.pth"
if [ ! -f "$UPSCALE_DIR/$UPSCALE_MODEL" ]; then
  mkdir -p "$UPSCALE_DIR"
  echo "entrypoint: downloading $UPSCALE_MODEL for LongLook/HD upscale..."
  wget -q -O "$UPSCALE_DIR/$UPSCALE_MODEL" \
    "https://huggingface.co/xingren23/comfyflow-models/resolve/main/upscale_models/$UPSCALE_MODEL" || true
  [ -f "$UPSCALE_DIR/$UPSCALE_MODEL" ] && echo "entrypoint: $UPSCALE_MODEL ready" || echo "entrypoint: WARNING — $UPSCALE_MODEL download failed"
fi

# ── Symlink custom nodes from network volume ─────────────────────
if [ -d "$VOLUME/custom_nodes" ]; then
  for node_dir in "$VOLUME/custom_nodes"/*/; do
    node_name=$(basename "$node_dir")
    container_node="/comfyui/custom_nodes/$node_name"
    if [ ! -e "$container_node" ]; then
      ln -sf "$node_dir" "$container_node"
      echo "entrypoint: symlinked custom node $node_name"
    fi
  done
fi

# ── Safety net: clone missing critical custom nodes ──────────────
for node_entry in \
  "ComfyUI-VideoHelperSuite|https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git|requirements.txt" \
  "ComfyUI-GGUF|https://github.com/city96/ComfyUI-GGUF.git|requirements.txt" \
  "ComfyUI-VFI|https://github.com/GACLove/ComfyUI-VFI.git|requirements.txt" \
  "comfyUI-LongLook|https://github.com/shootthesound/comfyUI-LongLook.git|" \
  "ComfyUI-MediaMixer|https://github.com/DoctorDiffusion/ComfyUI-MediaMixer.git|requirements.txt"; do
  IFS='|' read -r dir url reqs <<< "$node_entry"
  if [ ! -f "/comfyui/custom_nodes/$dir/__init__.py" ] && [ ! -L "/comfyui/custom_nodes/$dir" ]; then
    echo "entrypoint: $dir missing — cloning..."
    cd /comfyui/custom_nodes && git clone --depth 1 "$url" "$dir" 2>&1
    [ -n "$reqs" ] && [ -f "/comfyui/custom_nodes/$dir/$reqs" ] && \
      pip install -q -r "/comfyui/custom_nodes/$dir/$reqs" 2>&1 | tail -3
    echo "entrypoint: $dir installed"
  fi
done

# ── Clean stale job output from network volume ─────────────────
WORKSPACE="/workspace"
if [ -d "$WORKSPACE" ]; then
  count=$(find "$WORKSPACE" -maxdepth 1 -mindepth 1 -type d -regextype posix-extended \
    -regex '.*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-u[0-9]+)?' 2>/dev/null | wc -l)
  if [ "$count" -gt 0 ]; then
    find "$WORKSPACE" -maxdepth 1 -mindepth 1 -type d -regextype posix-extended \
      -regex '.*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-u[0-9]+)?' \
      -exec rm -rf {} + 2>/dev/null
    echo "entrypoint: removed $count stale job dirs"
  fi
fi

# Clean ComfyUI output cache
rm -rf /comfyui/output/*.png /comfyui/output/*.jpg 2>/dev/null
rm -rf /comfyui/output/video/* /comfyui/output/wan2-2/* 2>/dev/null

# ── Force --gpu-only mode for H200 ──────────────────────────────
if [ -f /start.sh ] && ! grep -q "\-\-gpu-only" /start.sh 2>/dev/null; then
  sed -i 's|main\.py|main.py --gpu-only|g' /start.sh
  echo "entrypoint: injected --gpu-only"
fi

# ── Patch handler.py (merge gifs/videos into images) ────────────
if [ -f /handler.py ] && ! grep -q "PATCH.*gifs/videos" /handler.py 2>/dev/null; then
  python3 -c "
import re
with open('/handler.py','r') as f: src = f.read()
pat = r'(for\s+\w+,\s*\w+\s+in\s+outputs\.items\(\):)'
m = re.search(pat, src)
if m:
    line_start = src.rfind('\n', 0, m.start()) + 1
    indent = ''
    for ch in src[line_start:m.start()]:
        if ch in (' ','\t'): indent += ch
        else: break
    bi = indent + '    '
    patch = (
        f'\n{bi}# [PATCH] Merge gifs/videos into images so they get processed\n'
        f'{bi}for _vk in (\"gifs\", \"videos\"):\n'
        f'{bi}    if _vk in node_output:\n'
        f'{bi}        node_output.setdefault(\"images\", []).extend(node_output[_vk])\n'
        f'{bi}        del node_output[_vk]\n'
    )
    src = src[:m.end()] + patch + src[m.end():]
    with open('/handler.py','w') as f: f.write(src)
    print('entrypoint: handler.py patched')
else:
    print('entrypoint: WARNING — could not find outputs loop in handler.py')
" 2>&1
else
  echo "entrypoint: handler.py patch OK"
fi

echo "entrypoint: done"
exec "$@"
