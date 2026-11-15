"""Translate Word Atlas entries into Turkish with the Claude API.

Reads   data/source/word-atlas.zh.json (run apply_tr.py once first, it creates it)
Writes  data/tr/auto-<first-index>-<id-hash>.json, one file per batch. Resumable: words that
        already have Turkish in any data/tr/*.json file are skipped.

Usage (bash)
  export ANTHROPIC_API_KEY=sk-ant-...
  python3 scripts/tr/translate_tr.py --sample 60 --dry-run  # show the plan, no API call
  python3 scripts/tr/translate_tr.py --sample 60            # spread over A1..C2, to check quality
  python3 scripts/tr/translate_tr.py --limit 200            # or the next 200 words in order
  python3 scripts/tr/translate_tr.py --workers 4            # then everything
  python3 scripts/tr/qa_tr.py                               # validate the overlays
  python3 scripts/tr/apply_tr.py                            # rebuild the app data

Options: --model (default claude-haiku-5-5, or env TR_MODEL), --effort low|medium|high (default low),
         --batch 15, --limit N, --sample N (mutually exclusive with --limit), --workers 4, --dry-run
Only the Python standard library is needed.
"""
import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import pathlib
import re
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "source" / "word-atlas.zh.json"
TR = ROOT / "data" / "tr"
CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]
PRICE_IN, PRICE_OUT = 0.10, 0.50  # USD per million tokens, Haiku 5.5
USAGE = {"in": 0, "out": 0}
USAGE_LOCK = threading.Lock()
POS_LABEL = re.compile(r"^\s*(isim|fiil|sıfat|zarf|edat|bağlaç|zamir|ünlem|n|v|adj|adv|prep)\s*\.", re.I)

SYSTEM = """You translate entries of an illustrated English vocabulary app for Turkish speakers (IELTS learners, CEFR A1–C2).
For every input entry return Turkish text that lines up one-to-one with the English:
- "senses": one Turkish gloss per input sense, in the same order. A gloss is what a bilingual dictionary prints: only the Turkish equivalent word(s), 1–3 of them separated by "; ", at most 30 characters. NEVER translate or paraphrase the English definition, and NEVER add a part-of-speech label ("isim.", "fiil.", "sıfat." …): the app shows the part of speech itself. The definition ("def") and the Chinese gloss ("zh") only tell you which meaning is meant; the zh gloss shows the expected length and style. Verbs in the -mek/-mak form, adjectives as adjectives.
  Good: mayor n. → "belediye başkanı"; fold v. (a business closes) → "batmak; kapanmak"; bet v. (feel sure) → "emin olmak"; pursuit n. (hobby) → "uğraş; hobi".
  Bad: "isim. bir şehri yöneten resmi görevli; belediye başkanı" (label + translated definition).
- "ex": a natural, fluent Turkish translation of each English example sentence, same order. Not word-for-word. Always use correct Turkish letters (ç ğ ı İ ö ş ü).
- "col": the Turkish meaning of each English collocation, same order (just the Turkish, not the English).
- "tip": one short, useful usage tip in Turkish (max ~120 characters). A Chinese tip is given as a hint about what matters; adapt it for Turkish speakers and drop anything only relevant to Chinese. Mention typical Turkish-speaker mistakes only when there is a real one. Never add filler comparisons with Turkish, never make claims about Turkish spelling or usage you are not certain of (follow TDK spelling, e.g. "cıva"), and never invent etymology. If there is no Turkish-specific point, give a grammar or usage point about the English word.
- "note": Turkish translation of the Chinese note if one is given, else "".
Return strict JSON only: {"entries":[{"id":..., "senses":[...], "ex":[...], "col":[...], "tip":"...", "note":"..."}]} with the same ids in the same order."""


def payload_for(batch):
    items = []
    for e in batch:
        items.append({
            "id": e["id"], "word": e["w"],
            "senses": [{"pos": s["pos"], "def": s["en"], "zh": s["zh"]} for s in e["senses"]],
            "ex": [x["en"] for x in e["ex"]],
            "col": [c.split("｜")[0] for c in e["col"]],
            "tip_zh": e.get("tip", ""),
            "note_zh": e.get("note", ""),
        })
    return json.dumps(items, ensure_ascii=False)


def call_claude(key, model, effort, batch):
    body = json.dumps({
        "model": model,
        "max_tokens": 16000,
        "output_config": {"effort": effort},
        "system": SYSTEM,
        "messages": [{"role": "user", "content": payload_for(batch)}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    reason = data.get("stop_reason")
    if reason != "end_turn":
        raise ValueError(f"stop_reason {reason}")
    text = "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
    text = re.sub(r"^```(?:json)?|```$", "", text.strip()).strip()
    entries = json.loads(text)["entries"]
    usage = data.get("usage") or {}
    with USAGE_LOCK:  # only counted for successful calls
        USAGE["in"] += usage.get("input_tokens", 0)
        USAGE["out"] += usage.get("output_tokens", 0)
    return entries


def check(batch, out):
    if [o.get("id") for o in out] != [e["id"] for e in batch]:
        raise ValueError("ids do not match")
    for e, o in zip(batch, out):
        if len(o.get("senses", [])) != len(e["senses"]) or len(o.get("ex", [])) != len(e["ex"]) or len(o.get("col", [])) != len(e["col"]):
            raise ValueError(f'counts do not line up for {e["id"]}')
        for g in o["senses"]:
            if not isinstance(g, str) or POS_LABEL.match(g) or len(g) > 60:
                raise ValueError(f'sense for {e["id"]} is not a short gloss: {str(g)[:70]}')


def dest_for(start, batch):
    h = hashlib.sha1("|".join(e["id"] for e in batch).encode("utf-8")).hexdigest()[:8]
    return TR / f"auto-{start:05d}-{h}.json"


def run(key, model, effort, start, batch):
    dest = dest_for(start, batch)
    if dest.exists():
        return start, "cached"
    for attempt in range(5):
        try:
            out = call_claude(key, model, effort, batch)
            check(batch, out)
            dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
            return start, "ok"
        except (urllib.error.URLError, ValueError, KeyError, json.JSONDecodeError, TimeoutError, ConnectionError) as err:
            # 400/401/403/404 are our fault: stop. 429, 529 and 5xx fall through to the retry.
            if isinstance(err, urllib.error.HTTPError) and err.code in (400, 401, 403, 404):
                raise SystemExit(f"API error {err.code}: {err.read().decode()[:300]}")
            wait = 10 * (attempt + 1)
            print(f"  batch {start}: {err} — retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    return start, "failed"


def pick_sample(todo, n):
    """n untranslated words spread evenly over A1..C2, deterministic, returned in source order."""
    groups = {c: [t for t in todo if t[1]["cefr"] == c] for c in CEFR}
    quota = {c: 0 for c in CEFR}
    n = min(n, len(todo))
    base, extra = divmod(n, len(CEFR))
    for k, c in enumerate(CEFR):
        quota[c] = min(base + (1 if k < extra else 0), len(groups[c]))
    left = n - sum(quota.values())
    while left > 0:  # redistribute what small levels could not supply
        room = [c for c in CEFR if quota[c] < len(groups[c])]
        if not room:
            break
        for c in room:
            if left and quota[c] < len(groups[c]):
                quota[c] += 1
                left -= 1
    chosen = []
    for c in CEFR:
        g, q = groups[c], quota[c]
        chosen += [g[(j * len(g)) // q + len(g) // (2 * q)] for j in range(q)] if q else []
    return sorted(chosen, key=lambda t: t[0])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("TR_MODEL", "claude-haiku-5-5"))
    ap.add_argument("--effort", choices=["low", "medium", "high"], default="low")
    ap.add_argument("--batch", type=int, default=15)
    grp = ap.add_mutually_exclusive_group()
    grp.add_argument("--limit", type=int, default=0, help="translate at most N new words")
    grp.add_argument("--sample", type=int, default=0, help="translate N new words spread evenly over A1..C2")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--dry-run", action="store_true", help="print the plan and exit (no API key or network)")
    a = ap.parse_args()
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not a.dry_run and not key:
        sys.exit("Set ANTHROPIC_API_KEY first.")
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
    elif a.sample:
        todo = pick_sample(todo, a.sample)
    batches = [todo[n : n + a.batch] for n in range(0, len(todo), a.batch)]
    print(f"{len(done)} already translated, {len(todo)} to go in {len(batches)} batches with {a.model} (effort {a.effort})")

    if a.dry_run:
        per = {c: sum(1 for _, e in todo if e["cefr"] == c) for c in CEFR}
        print("per level:", ", ".join(f"{c}={n}" for c, n in per.items()))
        print("first ids:", ", ".join(e["id"] for _, e in todo[:8]))
        for b in batches[:5]:
            print(f"  {dest_for(b[0][0], [e for _, e in b]).name}  ({len(b)} words)")
        if len(batches) > 5:
            print(f"  ... {len(batches) - 5} more batches")
        return

    failed = 0
    with cf.ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(run, key, a.model, a.effort, b[0][0], [e for _, e in b]) for b in batches]
        for k, f in enumerate(cf.as_completed(futs), 1):
            start, status = f.result()
            failed += status == "failed"
            print(f"[{k}/{len(batches)}] batch starting at {start}: {status}")
    cost = USAGE["in"] / 1e6 * PRICE_IN + USAGE["out"] / 1e6 * PRICE_OUT
    print(f"tokens: {USAGE['in']} input, {USAGE['out']} output; ~${cost:.4f} (estimate at Haiku 5.5 prices)")
    print("done" if not failed else f"{failed} batches failed — run again to retry them")


if __name__ == "__main__":
    main()
