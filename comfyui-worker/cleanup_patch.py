"""
Patch: Add post-job cleanup to handler.py so ComfyUI output files and
RunPod SDK staging directories don't accumulate on the network volume.

Wraps the handler function to clean up /comfyui/output/ and /workspace/
after each job completes.
"""

HANDLER_PATH = "/handler.py"

CLEANUP_CODE = '''
# [PATCH] Post-job cleanup — remove generated outputs from local disk
import glob as _glob
import shutil as _shutil

def _cleanup_job_files(job_id=None):
    """Remove ComfyUI output files and RunPod staging dirs after each job."""
    import os
    # Clean ComfyUI output (images + videos accumulate here)
    for pattern in ["/comfyui/output/*.png", "/comfyui/output/*.jpg",
                    "/comfyui/output/video/*", "/comfyui/output/wan2-2/*"]:
        for f in _glob.glob(pattern):
            try:
                if os.path.isfile(f):
                    os.remove(f)
                elif os.path.isdir(f):
                    _shutil.rmtree(f, ignore_errors=True)
            except Exception:
                pass
    # Clean RunPod staging dirs (/workspace/{job_id}-u{N})
    if job_id:
        for d in _glob.glob(f"/workspace/{job_id}*"):
            _shutil.rmtree(d, ignore_errors=True)

_original_handler = handler

def _cleanup_handler(job):
    """Wrapper that calls cleanup after the original handler returns."""
    result = _original_handler(job)
    try:
        _cleanup_job_files(job.get("id"))
    except Exception:
        pass
    return result

handler = _cleanup_handler
'''

with open(HANDLER_PATH, "r") as f:
    content = f.read()

if "_cleanup_handler" in content:
    print("handler.py already has cleanup patch — skipping")
else:
    with open(HANDLER_PATH, "a") as f:
        f.write(CLEANUP_CODE)
    print("handler.py patched — post-job cleanup enabled")
