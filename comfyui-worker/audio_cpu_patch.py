"""
Patch: VHS_VideoCombine crashes when muxing LTX-2.3's NATIVE AUDIO.

LTX's `LTXVAudioVAEDecode` returns the audio waveform on the GPU (cuda:0), but
VideoHelperSuite's VideoCombine does `audio['waveform']...numpy().tobytes()`
WITHOUT moving it to CPU first — it assumes CPU audio (as produced by
VHS_LoadVideo). Result: "can't convert cuda:0 device type tensor to numpy.
Use Tensor.cpu() to copy the tensor to host memory first."

The video-frame path in the same file already does `.cpu().numpy()` (which is
why silent video works); only the audio path was missing it. This inserts
`.cpu()` before the audio `.numpy().tobytes()`. Idempotent.
"""
import glob

NODES = glob.glob("/comfyui/custom_nodes/ComfyUI-VideoHelperSuite/videohelpersuite/nodes.py")

OLD = ".numpy().tobytes()"
NEW = ".cpu().numpy().tobytes()"

if not NODES:
    print("WARNING: VideoHelperSuite nodes.py not found — LTX audio patch SKIPPED")

for path in NODES:
    with open(path) as f:
        content = f.read()
    if NEW in content:
        print(f"{path}: LTX audio .cpu() patch already applied — skipping")
        continue
    if OLD not in content:
        print(f"WARNING: {path}: target '{OLD}' not found — VHS layout changed, NOT patched")
        continue
    content = content.replace(OLD, NEW)
    with open(path, "w") as f:
        f.write(content)
    print(f"{path}: patched audio waveform -> .cpu().numpy() (LTX native-audio mux fix)")
