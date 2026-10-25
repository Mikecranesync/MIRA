"""Sentence-level scores for the probabilistic validators (V2 embedding provenance, V3 NLI). Zero tokens.

For every answer in the frozen corpus, split the answer into factual sentences and score each one against
windows of the text of the pages it cites. Thresholds are NOT applied here — `analyze.py` applies the
dev-tuned thresholds, so tuning never re-runs a model.

  V2: cosine(nomic-embed-text("search_query: " + sentence), nomic-embed-text("search_document: " + window))
      via the local Ollama (the mechanism of Guardrails provenance_embeddings, without the framework).
  V3: cross-encoder NLI, premise = window, hypothesis = sentence; softmax over the model's labels.

Usage (venv with sentence-transformers 5.7.0, torch 2.14.1):
  python run_sentence_scores.py nli cross-encoder/nli-deberta-v3-base <corpus.jsonl> <out.jsonl>
  python run_sentence_scores.py emb nomic-embed-text <corpus.jsonl> <out.jsonl>
"""

from __future__ import annotations

import json
import re
import resource
import sys
import time

WINDOW_WORDS = 120
STRIDE_WORDS = 60
REFUSAL = re.compile(
    r"\b(do(?:es)? not (?:say|state|include|show|list|name|specify)|not (?:stated|listed|included|shown)|"
    r"can(?:no|')t find|couldn't find|i (?:can't|cannot|don't) (?:find|see)|not in the (?:loaded |retrieved )?(?:excerpts|pages)|"
    r"i'd need|i would need|if you (?:share|upload|add))",
    re.I,
)


def sentences(answer: str) -> list[str]:
    """Factual sentences of an answer with its bracketed `[n]` citation markers removed.

    Only bracketed markers are removed; a bare number is NEVER treated as a citation (Codex #4550 r1/r2
    F2: "bit 12 [1]" must stay "bit 12" even when a citation is numbered 12). The corpus carries the raw
    streamed answer, whose markers are bracketed, not the rendered one that shows them as bare digits.
    """
    a = re.sub(r"\s*\[\d+\]", "", answer)
    a = re.sub(r"[*_`#>|]", " ", a)
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(])|\n+", a)
    out = []
    for p in parts:
        p = re.sub(r"\s+", " ", p).strip(" -•\t")
        p = re.sub(r"\s+([.!?,;])", r"\1", p)
        if len(p.split()) < 4 or REFUSAL.search(p):
            continue
        out.append(p)
    return out


def windows(text: str) -> list[str]:
    w = text.split()
    if not w:
        return []
    out = []
    for i in range(0, max(1, len(w) - WINDOW_WORDS + STRIDE_WORDS), STRIDE_WORDS):
        out.append(" ".join(w[i : i + WINDOW_WORDS]))
    return out


def main() -> int:
    mode, model_id, corpus, out_path = sys.argv[1:5]
    items = [json.loads(line) for line in open(corpus)]
    t_load = time.perf_counter()
    if mode == "nli":
        import torch
        from sentence_transformers import CrossEncoder

        dev = "mps" if torch.backends.mps.is_available() else "cpu"
        model = CrossEncoder(model_id, device=dev)
        labels = {v.lower(): int(k) for k, v in model.model.config.id2label.items()}
        ent_i, con_i = labels["entailment"], labels["contradiction"]
    else:
        import httpx

        client = httpx.Client(base_url="http://127.0.0.1:11434", timeout=120)
        dev = "ollama"

        def embed(texts: list[str]) -> list[list[float]]:
            r = client.post(
                "/api/embed", json={"model": model_id, "input": texts, "keep_alive": "1h"}
            )
            r.raise_for_status()
            return r.json()["embeddings"]

    load_s = time.perf_counter() - t_load
    lat = []
    with open(out_path, "w") as fh:
        for it in items:
            t0 = time.perf_counter()
            sents = sentences(it["answer"])
            wins = [w for ev in it["evidence"] for w in windows(ev["text"])]
            scored = []
            if sents and wins:
                if mode == "nli":
                    pairs = [(w, s) for s in sents for w in wins]
                    probs = model.predict(
                        pairs, apply_softmax=True, batch_size=64, show_progress_bar=False
                    )
                    k = len(wins)
                    for si, s in enumerate(sents):
                        block = probs[si * k : (si + 1) * k]
                        best = int(block[:, ent_i].argmax())
                        scored.append(
                            {
                                "s": s,
                                "ent": float(block[best, ent_i]),
                                "con_at_best": float(block[best, con_i]),
                                "max_con": float(block[:, con_i].max()),
                            }
                        )
                else:
                    import math

                    qv = embed([f"search_query: {s}" for s in sents])
                    dv = embed([f"search_document: {w}" for w in wins])

                    def cos(a, b):
                        return sum(x * y for x, y in zip(a, b)) / (
                            math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
                        )

                    for s, q in zip(sents, qv):
                        scored.append({"s": s, "cos": max(cos(q, d) for d in dv)})
            lat.append(time.perf_counter() - t0)
            fh.write(
                json.dumps(
                    {
                        "item_id": it["item_id"],
                        "validator": f"{mode}:{model_id}",
                        "n_windows": len(wins),
                        "sentences": scored,
                    }
                )
                + "\n"
            )
    lat.sort()
    rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 2**20  # macOS reports bytes
    print(
        json.dumps(
            {
                "validator": f"{mode}:{model_id}",
                "device": dev,
                "n": len(items),
                "load_s": round(load_s, 1),
                "p50_s": round(lat[len(lat) // 2], 3),
                "p95_s": round(lat[int(len(lat) * 0.95)], 3),
                "max_rss_mb": round(rss_mb),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
