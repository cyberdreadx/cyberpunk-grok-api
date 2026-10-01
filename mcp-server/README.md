# gltch-runner-mcp

An [MCP](https://modelcontextprotocol.io) server for the
[GLTCH Runner](https://grokrunner.gltch.app) image and video generation API.

Point Claude, Cursor, or any MCP client at your GLTCH Runner account and let it
generate images, edit images, and animate stills directly in the conversation.

## Setup

You need an API key. Create one in the app under **Settings → API Keys**; keys
begin with `gltch_sk_`.

### Claude Code

```bash
claude mcp add gltch-runner \
  --env GLTCH_API_KEY=gltch_sk_your_key_here \
  -- npx -y gltch-runner-mcp
```

### Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gltch-runner": {
      "command": "npx",
      "args": ["-y", "gltch-runner-mcp"],
      "env": {
        "GLTCH_API_KEY": "gltch_sk_your_key_here"
      }
    }
  }
}
```

Restart the client and the tools appear.

## Tools

| Tool | What it does | Credits |
|---|---|---|
| `list_models` | Lists engines, prices, checkpoints and LoRAs | free |
| `generate_image` | Generates an image (`zimage`, `txt2img`, or `klein` to edit) | 3–4 |
| `edit_image` | Edits an existing image with the GLTCH engine | 5, or 7 HD |
| `generate_video` | Animates a still into a short video | 15 |
| `check_job` | Collects a video that was still rendering | free |

**These tools spend real credits** from the account that owns the key. Only
`list_models` is free. Buy credits or subscribe in the app.

Start with `list_models` — it returns the checkpoint and LoRA names the other
tools accept, so you aren't guessing at strings. `check_job` with no arguments
lists your recent jobs.

## Choosing a workflow

`generate_image` takes three:

- **`zimage`** — text to image. Fastest, no source image. The default.
- **`txt2img`** — text to image on a specific checkpoint. Needs `checkpoint`.
- **`klein`** — edits or restyles an image you already have. Needs `image_url`.

`generate_video` takes `gltch-wan` (the engine the app itself uses, and the
default here) or `wan-video`. Both animate a still, so both need `image_url`.

Video runs through the asynchronous `/api/v1/jobs` endpoint, so it is not
bound by the 280-second ceiling on the synchronous one. `generate_video`
submits the job and waits for it — expect a call lasting several minutes.

If it stops waiting before the render finishes, the job keeps going on the
server and you get a `job_id` back. Hand that to `check_job` to collect it.
Nothing is lost and you are not charged twice. A job that fails or expires is
refunded in full.

## Configuration

| Variable | Required | Default |
|---|---|---|
| `GLTCH_API_KEY` | yes | — |
| `GLTCH_API_BASE` | no | `https://api.gltch.app` |

Use `api.gltch.app`, not `grokrunner.gltch.app`. The app host proxies to the
same backend but times out at about 26 seconds, which is shorter than a real
generation takes.

## Errors worth knowing

The server translates HTTP status codes into something actionable:

- **402** — out of credits. Buy more; retrying won't help.
- **403** — the account holding the key hasn't verified its email.
- **429** — rate limited. Wait, then retry.
- **502 / 504** — the job failed or timed out. **Credits are refunded
  automatically**, so a retry costs nothing extra.

If a call times out client-side, the job may still finish server-side. Check
your library in the app before spending credits on a retry.

## Building from source

```bash
npm install
npm run build
node dist/index.js    # speaks MCP over stdio
```

## Links

- [API documentation](https://grokrunner.gltch.app/api-docs)
- [GLTCH Runner](https://grokrunner.gltch.app)

MIT
