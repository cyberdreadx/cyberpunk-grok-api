"""
GLTCH Vast.ai worker agent.

Runs the SAME RunPod handler (/handler.py from runpod/worker-comfyui) but takes
jobs from GLTCH instead of RunPod: it PULLS from https://api.gltch.app/api/vast-worker
with a per-machine token, so nothing listens on this machine.

  python3 /vast_agent.py --download   # boot step: fetch models (signed R2 URLs)
  python3 /vast_agent.py              # started by /start.sh in place of handler.py

Env (set by the scaler when it rents the machine):
  GLTCH_API, GLTCH_WORKER_TOKEN, GLTCH_POOL
"""
import importlib.util
import os
import subprocess
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

import requests

API = os.environ.get("GLTCH_API", "https://api.gltch.app").rstrip("/") + "/api/vast-worker"
TOKEN = os.environ.get("GLTCH_WORKER_TOKEN", "")
MODELS_DIR = "/runpod-volume/runpod-slim/ComfyUI/models"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def call(action, timeout=60, **body):
    for attempt in range(6):
        try:
            r = requests.post(API, json={"action": action, **body}, headers=HEADERS, timeout=timeout)
            if r.status_code == 410:
                print("[vast] machine retired by GLTCH — exiting", flush=True)
                sys.exit(0)
            r.raise_for_status()
            return r.json()
        except SystemExit:
            raise
        except Exception as e:  # network blip: back off and retry
            print(f"[vast] {action} failed ({e}); retry {attempt + 1}", flush=True)
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError(f"{action} kept failing")


def log(line):
    print(f"[vast] {line}", flush=True)
    try:
        call("log", timeout=10, line=line)
    except Exception:
        pass


# ── Boot: models ───────────────────────────────────────────────────────────

def fetch_one(m):
    dest = os.path.join(MODELS_DIR, m["path"])
    if not os.path.realpath(dest).startswith(MODELS_DIR + "/"):
        raise RuntimeError(f"refusing path {m['path']}")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if m.get("size") and os.path.exists(dest) and os.path.getsize(dest) == m["size"]:
        return m["path"], True
    tmp = dest + ".part"
    rc = subprocess.call(["curl", "-sfL", "--retry", "8", "--retry-all-errors", "-C", "-", "-o", tmp, m["url"]])
    if rc != 0:
        return m["path"], False
    if m.get("size") and os.path.getsize(tmp) != m["size"]:
        return m["path"], False
    os.replace(tmp, dest)
    return m["path"], True


def download_models():
    t0 = time.time()
    for round_ in range(4):  # URLs expire; re-ask the manifest for each round
        models = call("manifest")["models"]
        if not models:
            log("manifest is empty — models were never synced to R2")
            sys.exit(1)
        with ThreadPoolExecutor(max_workers=6) as ex:
            results = list(ex.map(fetch_one, models))
        missing = [p for p, ok in results if not ok]
        if not missing:
            gb = sum((m.get("size") or 0) for m in models) / 1e9
            log(f"models ready: {len(models)} files, {gb:.1f} GB in {int(time.time() - t0)}s")
            return
        log(f"round {round_ + 1}: {len(missing)} files incomplete, retrying: {missing[:5]}")
    log("could not download all models — giving up")
    sys.exit(1)


# ── Serve: pull jobs, run the RunPod handler ───────────────────────────────

def load_handler():
    # progress_update() posts to RunPod; there is no RunPod here.
    try:
        import runpod.serverless as rps
        rps.progress_update = lambda *a, **k: None
    except Exception:
        pass
    src = open("/handler.py").read()
    spec = importlib.util.spec_from_file_location("rp_handler", "/handler.py")
    mod = importlib.util.module_from_spec(spec)
    if "__main__" not in src:  # unguarded serverless.start() would grab the process
        src = src.replace("runpod.serverless.start(", "(lambda *a, **k: None)(")
        exec(compile(src, "/handler.py", "exec"), mod.__dict__)
    else:
        spec.loader.exec_module(mod)
    return mod.handler


def wait_for_comfy():
    for _ in range(600):
        try:
            if requests.get("http://127.0.0.1:8188/system_stats", timeout=3).ok:
                return
        except Exception:
            pass
        time.sleep(2)
    log("ComfyUI never came up")
    sys.exit(1)


def serve():
    handler = load_handler()
    wait_for_comfy()
    call("ready")
    log("ready for jobs")
    while True:
        job = call("next", timeout=40).get("job")
        if not job:
            continue
        jid = job["id"]
        t0 = time.time()
        try:
            out = handler({"id": jid, "input": job.get("input") or {}})
            if hasattr(out, "__next__"):  # generator handlers: keep the last chunk
                last = None
                for last in out:
                    pass
                out = last
            if isinstance(out, dict) and out.get("error"):
                call("result", timeout=300, id=jid, error=str(out["error"]))
            else:
                call("result", timeout=300, id=jid, output=out or {})
            print(f"[vast] {jid} done in {time.time() - t0:.0f}s", flush=True)
        except Exception as e:
            traceback.print_exc()
            call("result", timeout=60, id=jid, error=f"Worker error: {e}"[:1500])


if __name__ == "__main__":
    if "--download" in sys.argv:
        download_models()
    else:
        serve()
