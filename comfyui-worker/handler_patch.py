"""
Patch handler.py to support video outputs (gifs/videos keys from VHS_VideoCombine).

The stock RunPod worker-comfyui handler only processes node_output["images"].
VHS_VideoCombine outputs under "gifs" key. This patch duplicates the images
handling block for "gifs" and "videos" keys so video files get uploaded to S3
(or returned as base64) just like images.
"""

import re

HANDLER_PATH = "/handler.py"

with open(HANDLER_PATH, "r") as f:
    content = f.read()

# Find the block: if "images" in node_output:
# We want to add similar blocks for "gifs" and "videos" AFTER the images block.

# The patch: after the "images" processing block, add handling for gifs and videos.
# We'll insert code right after the "other_keys" warning block.

old_other_keys = '''            # Check for other output types
            other_keys = [k for k in node_output.keys() if k != "images"]
            if other_keys:
                warn_msg = (
                    f"Node {node_id} produced unhandled output keys: {other_keys}."
                )
                print(f"worker-comfyui - WARNING: {warn_msg}")
                print(
                    f"worker-comfyui - --> If this output is useful, please consider opening an issue on GitHub to discuss adding support."
                )'''

new_other_keys = '''            # Handle video outputs (gifs/videos from VHS_VideoCombine etc.)
            for video_key in ("gifs", "videos"):
                if video_key in node_output:
                    print(
                        f"worker-comfyui - Node {node_id} contains {len(node_output[video_key])} {video_key} output(s)"
                    )
                    for video_info in node_output[video_key]:
                        filename = video_info.get("filename")
                        subfolder = video_info.get("subfolder", "")
                        vid_type = video_info.get("type")

                        if vid_type == "temp":
                            print(
                                f"worker-comfyui - Skipping {video_key} {filename} because type is 'temp'"
                            )
                            continue

                        if not filename:
                            warn_msg = f"Skipping {video_key} in node {node_id} due to missing filename: {video_info}"
                            print(f"worker-comfyui - {warn_msg}")
                            errors.append(warn_msg)
                            continue

                        video_bytes = get_image_data(filename, subfolder, vid_type)

                        if video_bytes:
                            file_extension = os.path.splitext(filename)[1] or ".mp4"

                            if os.environ.get("BUCKET_ENDPOINT_URL"):
                                try:
                                    with tempfile.NamedTemporaryFile(
                                        suffix=file_extension, delete=False
                                    ) as temp_file:
                                        temp_file.write(video_bytes)
                                        temp_file_path = temp_file.name

                                    print(f"worker-comfyui - Uploading video {filename} to S3...")
                                    s3_url = rp_upload.upload_image(job_id, temp_file_path)
                                    os.remove(temp_file_path)
                                    print(
                                        f"worker-comfyui - Uploaded video {filename} to S3: {s3_url}"
                                    )
                                    output_data.append(
                                        {
                                            "filename": filename,
                                            "type": "s3_url",
                                            "data": s3_url,
                                        }
                                    )
                                except Exception as e:
                                    error_msg = f"Error uploading video {filename} to S3: {e}"
                                    print(f"worker-comfyui - {error_msg}")
                                    errors.append(error_msg)
                                    if "temp_file_path" in locals() and os.path.exists(
                                        temp_file_path
                                    ):
                                        try:
                                            os.remove(temp_file_path)
                                        except OSError as rm_err:
                                            print(
                                                f"worker-comfyui - Error removing temp file {temp_file_path}: {rm_err}"
                                            )
                            else:
                                try:
                                    base64_video = base64.b64encode(video_bytes).decode(
                                        "utf-8"
                                    )
                                    output_data.append(
                                        {
                                            "filename": filename,
                                            "type": "base64",
                                            "data": base64_video,
                                        }
                                    )
                                    print(f"worker-comfyui - Encoded video {filename} as base64")
                                except Exception as e:
                                    error_msg = f"Error encoding video {filename} to base64: {e}"
                                    print(f"worker-comfyui - {error_msg}")
                                    errors.append(error_msg)
                        else:
                            error_msg = f"Failed to fetch video data for {filename} from /view endpoint."
                            errors.append(error_msg)

            # Check for other output types
            other_keys = [k for k in node_output.keys() if k not in ("images", "gifs", "videos")]
            if other_keys:
                warn_msg = (
                    f"Node {node_id} produced unhandled output keys: {other_keys}."
                )
                print(f"worker-comfyui - WARNING: {warn_msg}")
                print(
                    f"worker-comfyui - --> If this output is useful, please consider opening an issue on GitHub to discuss adding support."
                )'''

if old_other_keys in content:
    content = content.replace(old_other_keys, new_other_keys)
    with open(HANDLER_PATH, "w") as f:
        f.write(content)
    print("handler.py patched successfully — gifs/videos output keys now supported")
else:
    print("WARNING: Could not find the expected 'other_keys' block in handler.py")
    print("The handler may have been updated. Manual patching may be needed.")
