"""Build the Turkish edition of Word Atlas from the original dataset plus Turkish overlays.

Inputs
  data/source/word-atlas.zh.json   original English–Chinese dataset (learning order)
  data/source/media.json           media bit flags per id (from the original index)
  data/tr/*.json                   Turkish overlays, one object per word:
      {"id", "senses": [tr...], "ex": [tr, tr], "col": [tr...], "tip": tr, "note": tr}
      Lists line up one-to-one with the English senses / examples / collocations.

Outputs
  public/atlas/index.json, public/atlas/entries/<n>.json   (only words that have Turkish)
  data/word-atlas-tr.json, data/word-atlas-tr.csv

The fields keep their original names ("zh") so the app code stays unchanged;
in this edition they hold Turkish text.

Usage: python3 scripts/tr/apply_tr.py
"""
import csv
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PUB = ROOT / "public" / "atlas"
DATA = ROOT / "data"
SRC = DATA / "source"
TR = DATA / "tr"

TOPICS = [
    ("education", "Eğitim"), ("work", "İş"), ("technology", "Teknoloji"), ("science", "Bilim"),
    ("environment", "Çevre"), ("health", "Sağlık"), ("society", "Toplum"), ("government", "Devlet ve hukuk"),
    ("economy", "Ekonomi"), ("media", "Medya"), ("arts", "Sanat"), ("travel", "Seyahat"),
    ("city", "Şehir"), ("nature", "Doğa"), ("daily", "Günlük yaşam"), ("emotion", "Duygular"),
    ("thinking", "Düşünce"), ("sport", "Spor"), ("history", "Tarih"),
]
TOPIC_INDEX = {k: i for i, (k, _) in enumerate(TOPICS)}
CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]


def snapshot_source():
    """First run: keep the original Chinese dataset and media flags as the source of truth."""
    SRC.mkdir(parents=True, exist_ok=True)
    if not (SRC / "word-atlas.zh.json").exists():
        shutil.copyfile(DATA / "word-atlas.json", SRC / "word-atlas.zh.json")
    if not (SRC / "media.json").exists():
        idx = json.loads((PUB / "index.json").read_text(encoding="utf-8"))
        if idx.get("lang") == "tr":
            sys.exit("public/atlas/index.json is already Turkish and data/source/media.json is missing")
        (SRC / "media.json").write_text(json.dumps({r[0]: r[6] for r in idx["words"]}), encoding="utf-8")


def load_overlays():
    out = {}
    for p in sorted(TR.glob("*.json")):
        for o in json.loads(p.read_text(encoding="utf-8")):
            out[o["id"]] = o
    return out


def merge(e, o, problems):
    """Return the entry with Turkish in the zh fields, or None if the overlay doesn't line up."""
    s_tr, x_tr, c_tr = o.get("senses") or [], o.get("ex") or [], o.get("col") or []
    if len(s_tr) != len(e["senses"]) or len(x_tr) != len(e["ex"]) or len(c_tr) != len(e["col"]):
        problems.append(f'{e["id"]}: counts senses {len(s_tr)}/{len(e["senses"])} ex {len(x_tr)}/{len(e["ex"])} col {len(c_tr)}/{len(e["col"])}')
        return None
    if not all(isinstance(t, str) and t.strip() for t in s_tr + x_tr):
        problems.append(f'{e["id"]}: empty translation')
        return None
    m = dict(e)
    m["senses"] = [{"pos": s["pos"], "zh": t.strip(), "en": s["en"]} for s, t in zip(e["senses"], s_tr)]
    m["ex"] = [{"en": x["en"], "zh": t.strip()} for x, t in zip(e["ex"], x_tr)]
    m["col"] = [f'{c.split("｜")[0].strip()}｜{t.strip()}' for c, t in zip(e["col"], c_tr)]
    m["tip"] = (o.get("tip") or "").strip()
    m["note"] = (o.get("note") or "").strip() if e.get("note") else ""
    return m


def main():
    snapshot_source()
    source = json.loads((SRC / "word-atlas.zh.json").read_text(encoding="utf-8"))
    media = json.loads((SRC / "media.json").read_text(encoding="utf-8"))
    overlays = load_overlays()

    problems, entries = [], []
    for e in source:  # keeps the original learning order
        o = overlays.get(e["id"])
        if o:
            m = merge(e, o, problems)
            if m:
                entries.append(m)

    chunks = PUB / "entries"
    for old in chunks.glob("*.json"):
        old.unlink()
    for n in range(0, len(entries), 100):
        chunk = [dict(c, m=media.get(c["id"], 0)) for c in entries[n : n + 100]]
        (chunks / f"{n // 100}.json").write_text(json.dumps(chunk, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    index = []
    for c in entries:
        s0 = c["senses"][0]
        index.append([c["id"], c["w"], f'{s0["pos"]} {s0["zh"]}'.strip(), c["uk"] or c["us"],
                      CEFR.index(c["cefr"]), TOPIC_INDEX[c["topic"]], media.get(c["id"], 0)])
    flags = [r[6] for r in index]
    meta = {
        "id": "word-atlas-tr",
        "version": 1,
        "lang": "tr",
        "name": "Kelime Atlası",
        "license": "CC BY 4.0",
        "count": len(index),
        "examples": sum(len(c["ex"]) for c in entries),
        "illustrated": sum(1 for m in flags if m & 1),
        "voiced": sum(1 for m in flags if m & 2),
        "chunk": 100,
        "topics": TOPICS,
        "cefr": CEFR,
        "fields": ["id", "word", "tr", "ipa", "cefr", "topic", "media"],
        "words": index,
    }
    (PUB / "index.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    public = [{k: v for k, v in c.items() if k != "m"} for c in entries]
    for c in public:  # rename for the downloadable dataset
        c["senses"] = [{"pos": s["pos"], "tr": s["zh"], "en": s["en"]} for s in c["senses"]]
        c["ex"] = [{"en": x["en"], "tr": x["zh"]} for x in c["ex"]]
    (DATA / "word-atlas-tr.json").write_text(json.dumps(public, ensure_ascii=False, indent=1), encoding="utf-8")
    with open(DATA / "word-atlas-tr.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "word", "ipa_uk", "ipa_us", "cefr", "topic", "meanings_tr", "definition_en",
                    "example1_en", "example1_tr", "example2_en", "example2_tr", "collocations", "word_family",
                    "synonyms", "antonyms", "tip_tr"])
        for c in public:
            ex = c["ex"] + [{"en": "", "tr": ""}] * (2 - len(c["ex"]))
            w.writerow([c["id"], c["w"], c["uk"], c["us"], c["cefr"], c["topic"],
                        " | ".join(f'{s["pos"]} {s["tr"]}' for s in c["senses"]),
                        " | ".join(s["en"] for s in c["senses"]),
                        ex[0]["en"], ex[0]["tr"], ex[1]["en"], ex[1]["tr"],
                        " ; ".join(c["col"]), " ; ".join(c["fam"]), ", ".join(c["syn"]), ", ".join(c["ant"]), c["tip"]])

    print(f"Turkish words: {len(entries)} / {len(source)}  overlays: {len(overlays)}  problems: {len(problems)}")
    for p in problems[:30]:
        print("  ", p)
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    main()
