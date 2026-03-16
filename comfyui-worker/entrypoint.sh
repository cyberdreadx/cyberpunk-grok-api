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

# ── Swap old RIFE plugin for ComfyUI-VFI from network volume ──
# Remove broken ComfyUI-Frame-Interpolation (CPU-only RIFE) if still baked in
if [ -d "/comfyui/custom_nodes/ComfyUI-Frame-Interpolation" ]; then
  rm -rf /comfyui/custom_nodes/ComfyUI-Frame-Interpolation
  echo "entrypoint: removed old ComfyUI-Frame-Interpolation"
fi
# Symlink ComfyUI-VFI from network volume if available and not already present
VOL_VFI="/workspace/runpod-slim/ComfyUI/custom_nodes/ComfyUI-VFI"
if [ -d "$VOL_VFI" ] && [ ! -d "/comfyui/custom_nodes/ComfyUI-VFI" ]; then
  ln -sf "$VOL_VFI" /comfyui/custom_nodes/ComfyUI-VFI
  echo "entrypoint: symlinked ComfyUI-VFI from network volume"
elif [ -d "/comfyui/custom_nodes/ComfyUI-VFI" ]; then
  echo "entrypoint: ComfyUI-VFI OK"
fi

# ── Runtime safety net: ensure critical custom nodes exist ──────
# If any are missing, clone + install deps at startup (~30s penalty).
for node_entry in \
  "ComfyUI-VideoHelperSuite|https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git|requirements.txt" \
  "ComfyUI-GGUF|https://github.com/city96/ComfyUI-GGUF.git|requirements.txt" \
  "ComfyUI-VFI|https://github.com/GACLove/ComfyUI-VFI.git|requirements.txt"; do
  IFS='|' read -r dir url reqs <<< "$node_entry"
  if [ ! -f "/comfyui/custom_nodes/$dir/__init__.py" ]; then
    echo "entrypoint: $dir missing — cloning..."
    cd /comfyui/custom_nodes && git clone "$url" "$dir" 2>&1
    [ -f "/comfyui/custom_nodes/$dir/$reqs" ] && uv pip install -r "/comfyui/custom_nodes/$dir/$reqs" 2>&1
    echo "entrypoint: $dir installed"
  else
    echo "entrypoint: $dir OK"
  fi
done

# ── Sync deps from network volume ComfyUI (if updated) ────────
# If the volume has a newer ComfyUI with new requirements, install them.
for reqfile in /workspace/runpod-slim/ComfyUI/requirements.txt /workspace/ComfyUI/requirements.txt; do
  if [ -f "$reqfile" ]; then
    echo "entrypoint: installing deps from $reqfile"
    pip install -q -r "$reqfile" 2>&1 | tail -5
    break
  fi
done

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

# ── Force --gpu-only mode (H200 141GB — disable all VRAM management) ──
if ! grep -q "\-\-gpu-only" /start.sh 2>/dev/null; then
  sed -i 's|main\.py|main.py --gpu-only|g' /start.sh
  echo "entrypoint: injected --gpu-only into start.sh"
else
  echo "entrypoint: --gpu-only already set"
fi

# ── Re-apply handler patch (gifs/videos → images merge) ─────────
# The RunPod SDK may overwrite handler.py at startup, so re-patch every time.
if [ -f /handler.py ] && ! grep -q "PATCH.*gifs/videos" /handler.py 2>/dev/null; then
  python3 -c "
import re
with open('/handler.py','r') as f: src = f.read()
# Find the outputs loop and inject merge logic
pat = r'(for\s+\w+,\s*\w+\s+in\s+outputs\.items\(\):)'
m = re.search(pat, src)
if m:
    loop_line = m.group(0)
    indent = ''
    line_start = src.rfind('\n', 0, m.start()) + 1
    for ch in src[line_start:m.start()]:
        if ch in (' ','\t'): indent += ch
        else: break
    bi = indent + '    '
    patch = (
        f'\n{bi}# [PATCH] Merge gifs/videos into images so they get processed\n'
        f'{bi}for _vk in (\"gifs\", \"videos\"):\n'
        f'{bi}    if _vk in node_output:\n'
        f'{bi}        node_output.setdefault(\"images\", []).extend(node_output[_vk])\n'
    )
    src = src[:m.end()] + patch + src[m.end():]
    with open('/handler.py','w') as f: f.write(src)
    print('entrypoint: handler.py patched (gifs/videos merged into images)')
else:
    print('entrypoint: WARNING — could not find outputs loop in handler.py')
" 2>&1
else
  echo "entrypoint: handler.py patch already applied"
fi

exec "$@"

