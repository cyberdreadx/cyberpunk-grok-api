
## Raise GLTCH Animate to 12 credits, LongLook to 15 credits

Two files need updating — the frontend cost table and the backend cost table.

### Changes

**`src/lib/api.ts`** — line 96–97
- `comfyVideo: 8` → `comfyVideo: 12`
- `comfyLongLook: 5` → `comfyLongLook: 15`

**`api/comfyui.ts`** — lines 167–169
- `"gltch-wan": 5` → `"gltch-wan": 12`
- `"gltch-wan-hd": 7` → `"gltch-wan-hd": 14` *(HD should stay higher; currently 2cr above standard — keep same gap → 14)*
- `"longlook": 2` → `"longlook": 15`

> Note on LongLook: the backend multiplies the per-sequence cost by `sequenceCount` (max 4). With `"longlook": 2`, a 4-sequence job costs 8cr. Changing it to `15` flat (not per-sequence) requires a logic change — I'll update the cost calculation to use `15` as a flat cost (no multiplication), since a fixed 15cr regardless of sequence count is the cleaner UX.

### Files
- `src/lib/api.ts` — `comfyVideo`, `comfyLongLook`
- `api/comfyui.ts` — `COMFY_COSTS["gltch-wan"]`, `COMFY_COSTS["gltch-wan-hd"]`, `COMFY_COSTS["longlook"]`, and the cost calculation line that multiplies longlook by sequenceCount
