"""Validate the Turkish overlays in data/tr/*.json against data/source/word-atlas.zh.json.

Writes output/qa-tr.md (and output/review-tr.md with --review N). Exit code 1 if any errors.
Usage: python3 scripts/tr/qa_tr.py [--review N]
Only the Python standard library is needed.
"""
import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "source" / "word-atlas.zh.json"
TR = ROOT / "data" / "tr"
OUT = ROOT / "output"
CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]
CJK = re.compile("[　-〿一-鿿＀-￯]")
TURKISH = re.compile("[çğıİöşüÇĞÖŞÜ]")


def spread(items, n):
    """n items spread evenly over the list (deterministic)."""
    if n >= len(items):
        return list(items)
    return [items[(j * len(items)) // n + len(items) // (2 * n)] for j in range(n)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--review", type=int, default=0, help="write output/review-tr.md with N entries spread over A1..C2")
    a = ap.parse_args()
    if not SRC.exists():
        sys.exit("Missing data/source/word-atlas.zh.json (run apply_tr.py once first).")
    source = json.loads(SRC.read_text(encoding="utf-8"))
    by_id = {e["id"]: e for e in source}

    errors, warns, entries = [], [], []
    seen = {}
    for p in sorted(TR.glob("*.json")):
        for o in json.loads(p.read_text(encoding="utf-8")):
            wid = o.get("id")
            if wid in seen:
                errors.append(f"{wid}: duplicate id in {p.name} and {seen[wid]}")
                continue
            seen[wid] = p.name
            e = by_id.get(wid)
            if e is None:
                errors.append(f"{wid}: not in source ({p.name})")
                continue
            entries.append((e, o))
            s_tr, x_tr, c_tr = o.get("senses") or [], o.get("ex") or [], o.get("col") or []
            if len(s_tr) != len(e["senses"]) or len(x_tr) != len(e["ex"]) or len(c_tr) != len(e["col"]):
                errors.append(f'{wid}: counts senses {len(s_tr)}/{len(e["senses"])} ex {len(x_tr)}/{len(e["ex"])} col {len(c_tr)}/{len(e["col"])}')
            for name, lst in (("senses", s_tr), ("ex", x_tr), ("col", c_tr)):
                for k, t in enumerate(lst):
                    if not isinstance(t, str) or not t.strip():
                        errors.append(f"{wid}: empty {name}[{k}]")
            for name in ("senses", "ex", "col", "tip", "note"):
                v = o.get(name)
                vals = v if isinstance(v, list) else [v]
                if any(isinstance(t, str) and CJK.search(t) for t in vals):
                    errors.append(f"{wid}: CJK characters in {name}")
            for k, t in enumerate(s_tr):
                if isinstance(t, str) and len(t) > 40:
                    warns.append(f"{wid}: sense[{k}] is {len(t)} chars")
            tip = (o.get("tip") or "").strip()
            if not tip:
                warns.append(f"{wid}: empty tip")
            elif len(tip) > 160:
                warns.append(f"{wid}: tip is {len(tip)} chars")
            for k, (x, t) in enumerate(zip(e["ex"], x_tr)):
                if not isinstance(t, str):
                    continue
                if t.strip() == x["en"].strip():
                    errors.append(f"{wid}: ex[{k}] identical to English")
                elif len(t) > 25 and not TURKISH.search(t):
                    warns.append(f"{wid}: ex[{k}] has no Turkish letters")
            if (o.get("note") or "").strip() and not e.get("note"):
                warns.append(f"{wid}: note given but source note is empty")

    total = {c: sum(1 for e in source if e["cefr"] == c) for c in CEFR}
    got = {c: sum(1 for e, _ in entries if e["cefr"] == c) for c in CEFR}
    lines = [f"Entries checked: {len(entries)}", f"Errors: {len(errors)}", f"Warnings: {len(warns)}",
             "Translated per CEFR: " + ", ".join(f"{c} {got[c]}/{total[c]}" for c in CEFR)]
    OUT.mkdir(exist_ok=True)
    md = ["# Turkish overlay QA", ""] + [f"- {l}" for l in lines]
    md += ["", "## Errors", ""] + ([f"- {x}" for x in errors] or ["none"])
    md += ["", "## Warnings", ""] + ([f"- {x}" for x in warns] or ["none"])
    (OUT / "qa-tr.md").write_text("\n".join(md) + "\n", encoding="utf-8", newline="\n")
    print("\n".join(lines))
    print("Report: output/qa-tr.md")

    if a.review:
        groups = {c: [t for t in entries if t[0]["cefr"] == c] for c in CEFR}
        quota = {c: 0 for c in CEFR}
        left = min(a.review, len(entries))
        while left > 0:  # round-robin so levels with few entries hand the rest to the others
            for c in CEFR:
                if left and quota[c] < len(groups[c]):
                    quota[c] += 1
                    left -= 1
        pick = []
        for c in CEFR:
            pick += spread(groups[c], quota[c]) if quota[c] else []
        r = ["# Turkish review sample", ""]
        for e, o in pick:
            r += [f'## {e["w"]} ({e["cefr"]})', ""]
            for s, t in zip(e["senses"], o["senses"]):
                r.append(f'- {s["pos"]} {s["en"]} → {t} ({s["zh"]})')
            r.append("")
            for x, t in zip(e["ex"], o["ex"]):
                r += [f'- en: {x["en"]}', f"  tr: {t}"]
            r.append("")
            for c, t in zip(e["col"], o["col"]):
                r.append(f'- {c.split("｜")[0]} → {t}')
            r += ["", f'tip_zh: {e.get("tip", "")}', f'tip_tr: {o.get("tip", "")}', ""]
        (OUT / "review-tr.md").write_text("\n".join(r), encoding="utf-8", newline="\n")
        print(f"Review: output/review-tr.md ({len(pick)} entries)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
