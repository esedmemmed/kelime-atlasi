#!/usr/bin/env python3
"""Review helper for Turkish overlays: show / check / status / apply."""
import glob, json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "data", "source", "word-atlas.zh.json")
TR_DIR = os.path.join(ROOT, "data", "tr")
REV = os.path.join(ROOT, "output", "review")
CJK = re.compile("[　-〿一-鿿＀-￯]")
POS = re.compile(r"^\s*(isim|fiil|sıfat|zarf)\.", re.I)
KEY = re.compile(r"^([SEC])(\d+)$")
N_CHUNKS = 73


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def overlays():
    """Return {id: (file, index_in_file)} and {file: data}."""
    where, files = {}, {}
    for p in sorted(glob.glob(os.path.join(TR_DIR, "*.json"))):
        files[p] = load(p)
        for i, o in enumerate(files[p]):
            where[o["id"]] = (p, i)
    return where, files


def chunk(k):
    return load(SRC)[100 * k:100 * k + 100]


def fix_path(k):
    return os.path.join(REV, "fix-%03d.json" % k)


def cmd_show(k):
    sys.stdout.reconfigure(encoding="utf-8")
    where, files = overlays()
    for e in chunk(k):
        p, i = where[e["id"]]
        t = files[p][i]
        print("### %s (%s, %s)" % (e["id"], e["w"], e["cefr"]))
        for n, s in enumerate(e["senses"]):
            print("S%d %s %s [zh: %s] => %s" % (n, s["pos"], s["en"], s["zh"], t["senses"][n]))
        for n, x in enumerate(e["ex"]):
            print("E%d %s => %s" % (n, x["en"], t["ex"][n]))
        for n, c in enumerate(e["col"]):
            print("C%d %s => %s" % (n, c.split("｜")[0], t["col"][n]))
        print("T zh: %s" % e["tip"])
        print("T tr: %s" % t["tip"])
        if e.get("note"):
            print("N zh: %s" % e["note"])
            print("N tr: %s" % t["note"])


def current(t, key):
    m = KEY.match(key)
    if not m:
        return t["tip"] if key == "T" else t["note"]
    return t[{"S": "senses", "E": "ex", "C": "col"}[m.group(1)]][int(m.group(2))]


def validate(k):
    """Return (errors, warnings, fixes) for chunk k; fixes = {id: {key: value}}."""
    errs, warns = [], []
    path = fix_path(k)
    if not os.path.exists(path):
        return ["missing file %s" % path], warns, {}
    try:
        fixes = load(path)
    except ValueError as ex:
        return ["invalid JSON: %s" % ex], warns, {}
    if not isinstance(fixes, dict):
        return ["top level must be an object"], warns, {}
    src = {e["id"]: e for e in chunk(k)}
    where, files = overlays()
    for id_, fx in fixes.items():
        if id_ not in src:
            errs.append("%s: not in chunk %d" % (id_, k))
            continue
        if not isinstance(fx, dict):
            errs.append("%s: corrections must be an object" % id_)
            continue
        e = src[id_]
        p, i = where[id_]
        t = files[p][i]
        sizes = {"S": len(e["senses"]), "E": len(e["ex"]), "C": len(e["col"])}
        for key, v in fx.items():
            tag = "%s.%s" % (id_, key)
            m = KEY.match(key)
            if m:
                if int(m.group(2)) >= sizes[m.group(1)]:
                    errs.append("%s: index out of range" % tag)
                    continue
            elif key == "N":
                if not e.get("note"):
                    errs.append("%s: source note is empty" % tag)
                    continue
            elif key != "T":
                errs.append("%s: bad key" % tag)
                continue
            if not isinstance(v, str) or not v.strip():
                errs.append("%s: value must be a non-empty string" % tag)
                continue
            if CJK.search(v):
                errs.append("%s: contains CJK characters" % tag)
            if m and m.group(1) == "S":
                if len(v) > 40:
                    errs.append("%s: S longer than 40 chars (%d)" % (tag, len(v)))
                if POS.match(v):
                    errs.append("%s: S starts with a POS label" % tag)
            if key == "T" and len(v) > 160:
                errs.append("%s: T longer than 160 chars (%d)" % (tag, len(v)))
            if v == current(t, key):
                warns.append("%s: identical to current value" % tag)
    return errs, warns, fixes


def cmd_check(k):
    errs, warns, fixes = validate(k)
    for w in warns:
        print("WARN", w)
    if errs:
        for e in errs:
            print("ERROR", e)
        return 1
    print("OK chunk %d: %d entries, %d field corrections" % (k, len(fixes), sum(len(v) for v in fixes.values())))
    return 0


def cmd_status():
    missing = []
    for k in range(N_CHUNKS):
        if not os.path.exists(fix_path(k)):
            missing.append(k)
        else:
            errs, _, _ = validate(k)
            print("chunk %02d: %s" % (k, "pass" if not errs else "FAIL (%d errors)" % len(errs)))
    print("%d/%d chunks have a fix file" % (N_CHUNKS - len(missing), N_CHUNKS))
    print("missing: %s" % (", ".join(map(str, missing)) or "none"))


def cmd_apply(dry):
    where, files = overlays()
    changed_files, changed_entries, lines = set(), set(), []
    for p in sorted(glob.glob(os.path.join(REV, "fix-*.json"))):
        k = int(re.search(r"fix-(\d+)\.json$", p).group(1))
        errs, _, fixes = validate(k)
        if errs:
            print("SKIP %s (%d errors; run check %d)" % (os.path.basename(p), len(errs), k))
            continue
        for id_, fx in fixes.items():
            f, i = where[id_]
            t = files[f][i]
            for key, v in fx.items():
                old = current(t, key)
                if old == v:
                    continue
                m = KEY.match(key)
                if m:
                    t[{"S": "senses", "E": "ex", "C": "col"}[m.group(1)]][int(m.group(2))] = v
                else:
                    t["tip" if key == "T" else "note"] = v
                lines.append("%s %s %s => %s" % (id_, key, old, v))
                changed_files.add(f)
                changed_entries.add(id_)
    for l in lines:
        print(("would change: " if dry else "") + l)
    if not dry and lines:
        for f in changed_files:
            with open(f, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(files[f], ensure_ascii=False, indent=1))
        with open(os.path.join(REV, "applied.log"), "a", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines) + "\n")
    print("%s: %d files, %d entries, %d fields" % ("DRY RUN" if dry else "applied", len(changed_files), len(changed_entries), len(lines)))


def main(a):
    if len(a) >= 2 and a[0] in ("show", "check") and a[1].isdigit() and int(a[1]) < N_CHUNKS:
        return cmd_show(int(a[1])) if a[0] == "show" else cmd_check(int(a[1]))
    if a == ["status"]:
        return cmd_status()
    if a[:1] == ["apply"] and a[1:] in ([], ["--dry-run"]):
        return cmd_apply(bool(a[1:]))
    print("usage: review_tool.py show K | check K | status | apply [--dry-run]")
    return 2


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]) or 0)
