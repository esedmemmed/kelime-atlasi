"""Translate Word Atlas entries into Turkish with the Claude API.

Reads   data/source/word-atlas.zh.json (run apply_tr.py once first, it creates it)
Writes  data/tr/auto-<first-index>.json, one file per batch (resumable: words that
        already have Turkish in any data/tr/*.json file are skipped)

Usage
  export ANTHROPIC_API_KEY=sk-ant-...
  python3 scripts/tr/translate_tr.py --limit 200        # try a small batch first
  python3 scripts/tr/translate_tr.py --workers 4        # then everything
  python3 scripts/tr/apply_tr.py                        # rebuild the app data

Options: --model (default claude-sonnet-5-5, or env TR_MODEL), --batch 15, --limit N, --workers 4
Only the Python standard library is needed.
"""
import argparse
import concurrent.futures as cf
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "source" / "word-atlas.zh.json"
TR = ROOT / "data" / "tr"

SYSTEM = """You translate entries of an illustrated English vocabulary app for Turkish speakers (IELTS learners, CEFR A1–C2).
For every input entry return Turkish text that lines up one-to-one with the English:
- "senses": one Turkish meaning per English sense, in the same order. Short dictionary-style glosses (1–4 Turkish equivalents separated by "; ", at most ~30 characters), matching the part of speech and the English definition. Verbs in the -mek/-mak form.
- "ex": a natural, fluent Turkish translation of each English example sentence, same order. Not word-for-word.
- "col": the Turkish meaning of each English collocation, same order (just the Turkish, not the English).
- "tip": one short, useful usage tip in Turkish (max ~120 characters). A Chinese tip is given as a hint about what matters; adapt it for Turkish speakers and drop anything only relevant to Chinese. Mention typical Turkish-speaker mistakes when relevant. Never invent etymology.
- "note": Turkish translation of the Chinese note if one is given, else "".
Return strict JSON only: {"entries":[{"id":..., "senses":[...], "ex":[...], "col":[...], "tip":"...", "note":"..."}]} with the same ids in the same order."""


def payload_for(batch):
    items = []
    for e in batch:
        items.append({
            "id": e["id"], "word": e["w"],
            "senses": [f'{s["pos"]} {s["en"]}' for s in e["senses"]],
            "ex": [x["en"] for x in e["ex"]],
            "col": [c.split("｜")[0] for c in e["col"]],
            "tip_zh": e.get("tip", ""),
            "note_zh": e.get("note", ""),
        })
    return json.dumps(items, ensure_ascii=False)


def call_claude(key, model, batch):
    body = json.dumps({
        "model": model,
        "max_tokens": 16000,
        "system": SYSTEM,
        "messages": [{"role": "user", "content": payload_for(batch)}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    text = "".join(b.get("text", "") for b in data["content"])
    text = re.sub(r"^```(?:json)?|```$", "", text.strip()).strip()
    return json.loads(text)["entries"]


def check(batch, out):
    if [o.get("id") for o in out] != [e["id"] for e in batch]:
        raise ValueError("ids do not match")
    for e, o in zip(batch, out):
        if len(o.get("senses", [])) != len(e["senses"]) or len(o.get("ex", [])) != len(e["ex"]) or len(o.get("col", [])) != len(e["col"]):
            raise ValueError(f'counts do not line up for {e["id"]}')


def run(key, model, start, batch):
    dest = TR / f"auto-{start:05d}.json"
    if dest.exists():
        return start, "cached"
    for attempt in range(5):
        try:
            out = call_claude(key, model, batch)
            check(batch, out)
            dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
            return start, "ok"
        except (urllib.error.URLError, ValueError, KeyError, json.JSONDecodeError) as err:
            if isinstance(err, urllib.error.HTTPError) and err.code in (400, 401, 403, 404):
                raise SystemExit(f"API error {err.code}: {err.read().decode()[:300]}")
            wait = 10 * (attempt + 1)
            print(f"  batch {start}: {err} — retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    return start, "failed"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("TR_MODEL", "claude-sonnet-5-5"))
    ap.add_argument("--batch", type=int, default=15)
    ap.add_argument("--limit", type=int, default=0, help="translate at most N new words")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    key = os.environ.get("ANTHROPIC_API_KEY") or sys.exit("Set ANTHROPIC_API_KEY first.")
    if not SRC.exists():
        sys.exit("Run python3 scripts/tr/apply_tr.py once first (it creates data/source/).")
    TR.mkdir(parents=True, exist_ok=True)

    source = json.loads(SRC.read_text(encoding="utf-8"))
    done = set()
    for p in TR.glob("*.json"):
        done.update(o["id"] for o in json.loads(p.read_text(encoding="utf-8")))
    todo = [(i, e) for i, e in enumerate(source) if e["id"] not in done]
    if a.limit:
        todo = todo[: a.limit]
    batches = [todo[n : n + a.batch] for n in range(0, len(todo), a.batch)]
    print(f"{len(done)} already translated, {len(todo)} to go in {len(batches)} batches with {a.model}")

    failed = 0
    with cf.ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(run, key, a.model, b[0][0], [e for _, e in b]) for b in batches]
        for k, f in enumerate(cf.as_completed(futs), 1):
            start, status = f.result()
            failed += status == "failed"
            print(f"[{k}/{len(batches)}] batch starting at {start}: {status}")
    print("done" if not failed else f"{failed} batches failed — run again to retry them")


if __name__ == "__main__":
    main()
