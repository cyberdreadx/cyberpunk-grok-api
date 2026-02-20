"""
Patch: Make RunPod SDK's rp_upload.upload_image() read bucket name from
the BUCKET_NAME env var instead of defaulting to time.strftime("%m-%y").

Without this patch, uploads go to a bucket named after the current month-year
(e.g. "02-26") which doesn't exist.
"""

import glob
import sys

# Find rp_upload.py in the installed runpod package
candidates = glob.glob("/usr/**/runpod/serverless/utils/rp_upload.py", recursive=True)
if not candidates:
    candidates = glob.glob("/opt/**/runpod/serverless/utils/rp_upload.py", recursive=True)
if not candidates:
    candidates = glob.glob("/root/**/runpod/serverless/utils/rp_upload.py", recursive=True)

if not candidates:
    print("WARNING: Could not find rp_upload.py — bucket name patch not applied")
    print("S3 uploads will use the default month-year bucket name")
    sys.exit(0)

rp_upload_path = candidates[0]
print(f"Found rp_upload.py at: {rp_upload_path}")

with open(rp_upload_path, "r") as f:
    content = f.read()

# The line we need to patch:
#   bucket = bucket_name if bucket_name else time.strftime("%m-%y")
# Replace with:
#   bucket = bucket_name if bucket_name else os.environ.get("BUCKET_NAME", time.strftime("%m-%y"))

OLD = 'bucket = bucket_name if bucket_name else time.strftime("%m-%y")'
NEW = 'bucket = bucket_name if bucket_name else os.environ.get("BUCKET_NAME", time.strftime("%m-%y"))'

if OLD in content:
    content = content.replace(OLD, NEW)
    with open(rp_upload_path, "w") as f:
        f.write(content)
    print("rp_upload.py patched successfully — BUCKET_NAME env var now supported")
else:
    # Check if already patched
    if "BUCKET_NAME" in content:
        print("rp_upload.py already patched — skipping")
    else:
        print("WARNING: Could not find target line in rp_upload.py — patch not applied")
        print("Expected:", OLD)
