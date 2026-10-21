"""Component benchmark of the served reranker code (app.Reranker), one variant per process.
Runs inside the reranker image with --network none. Input: /in/requests.json. Output: JSON on stdout."""
import hashlib, json, os, platform, sys, time
sys.path.insert(0, "/app")
t0 = time.perf_counter()
import app  # the exact served module; RERANKER_MODEL / RERANKER_THREADS come from env
import onnxruntime as ort
r = app.Reranker(); r.load()
load_ms = (time.perf_counter() - t0) * 1000
reqs = json.load(open("/in/requests.json"))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
out = {"variant": app.MODEL_VARIANT, "threads": app.RERANKER_THREADS, "model_tag": app.MODEL_TAG,
       "onnx_file": str(app.ONNX_PATH), "onnx_sha256": sha(app.ONNX_PATH), "app_sha256": sha("/app/app.py"),
       "ort": ort.__version__, "machine": platform.machine(), "load_ms": load_ms,
       "cpu": next((l.split(":",1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name")), "n/a"),
       "rows": []}
def run(q):
    s = time.perf_counter(); sc = r.score(q["query"], q["passages"]); return (time.perf_counter() - s) * 1000, sc
cold_ms, _ = run(reqs[0]); out["cold_first_ms"] = cold_ms
for q in reqs[1:4]: run(q)  # warm-up, discarded
for q in reqs:
    try:
        ms, sc = run(q); out["rows"].append({"rid": q["rid"], "pool": q["pool"], "ms": ms, "scores": sc})
    except Exception as e:  # recorded, never hidden
        out["rows"].append({"rid": q["rid"], "pool": q["pool"], "error": repr(e)})
json.dump(out, sys.stdout)
