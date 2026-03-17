import json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

with open(r'longlook_workflow/Wan22_14B_I2V_MultiClip_LongLook/Wan22_14B_I2V_LL_Normal/Wan22_14B_I2V_LongLook_NORMAL.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

nodes = data.get('nodes', [])
links = data.get('links', [])

node_map = {n['id']: n for n in nodes}
link_map = {}
for lnk in links:
    link_id, src_node, src_slot, dst_node, dst_slot, link_type = lnk[0], lnk[1], lnk[2], lnk[3], lnk[4], lnk[5] if len(lnk)>5 else '?'
    link_map[link_id] = {'src': src_node, 'src_slot': src_slot, 'dst': dst_node, 'dst_slot': dst_slot, 'type': link_type}

key_types = [
    'KSamplerAdvanced', 'WanImageToVideo', 'WanFreeLong', 'WanFreeLongEnforcer',
    'WanMotionScale', 'WanMotionScaleAdvanced', 'WanContinuationConditioning',
    'FinalFrameSelector', 'UnetLoaderGGUF', 'CLIPLoader', 'VAELoader',
    'ModelSamplingSD3', 'LoraLoaderModelOnly', 'VAEDecode', 'ImageResizeKJ',
    'CLIPTextEncode'
]

for n in sorted(nodes, key=lambda x: x.get('id', 0)):
    ntype = n.get('type', '?')
    if ntype not in key_types:
        continue
    nid = n.get('id')
    title = n.get('title', '')
    widgets = n.get('widgets_values', [])
    label = f"[{nid}] {ntype}" + (f" ({title})" if title and title != ntype else "")
    print(label)
    
    short_vals = []
    for v in widgets:
        sv = str(v)
        if len(sv) > 60:
            sv = sv[:60] + "..."
        short_vals.append(sv)
    if short_vals:
        print(f"  widgets: {short_vals}")

    inputs = n.get('inputs', [])
    for inp in inputs:
        inp_name = inp.get('name', '?')
        link_id = inp.get('link')
        if link_id and link_id in link_map:
            lnk = link_map[link_id]
            src_n = node_map.get(lnk['src'], {})
            src_type = src_n.get('type', '?')
            src_title = src_n.get('title', '')
            print(f"  IN[{inp_name}] <- [{lnk['src']}] {src_type}" + (f" ({src_title})" if src_title else ""))
    print()
