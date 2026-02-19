"""
Minimal patch: make handler.py treat 'gifs' and 'videos' output keys
the same as 'images' by merging them before processing.

Injects one line right after 'if "images" in node_output:' detection
that merges gifs/videos into the images list.
"""

HANDLER_PATH = "/handler.py"

with open(HANDLER_PATH, "r") as f:
    lines = f.readlines()

patched = False
output_lines = []

for i, line in enumerate(lines):
    output_lines.append(line)
    # Find: for node_id, node_output in outputs.items():
    # Insert merging logic right after this line
    if "for node_id, node_output in outputs.items():" in line and not patched:
        # Get the indentation of the for loop body (next line's indentation + 4 spaces)
        indent = ""
        for ch in line:
            if ch in (" ", "\t"):
                indent += ch
            else:
                break
        body_indent = indent + "    "

        # Insert: merge gifs/videos into images before the "if images" check
        output_lines.append(f'{body_indent}# [PATCH] Merge gifs/videos into images so they get processed\n')
        output_lines.append(f'{body_indent}for _vk in ("gifs", "videos"):\n')
        output_lines.append(f'{body_indent}    if _vk in node_output:\n')
        output_lines.append(f'{body_indent}        node_output.setdefault("images", []).extend(node_output[_vk])\n')
        patched = True
        print("handler.py patched successfully - gifs/videos merged into images for processing")

if not patched:
    print("WARNING: Could not find outputs loop in handler.py - patch not applied")
    print("Image workflows will still work normally")

with open(HANDLER_PATH, "w") as f:
    f.writelines(output_lines)
