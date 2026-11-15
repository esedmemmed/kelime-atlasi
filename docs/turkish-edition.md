# Turkish edition: translation, review and rebuild

Kelime Atlası is the Turkish–English edition of [Word Atlas](https://github.com/designfuchen/word-atlas). This page explains how the Turkish text was produced and how to translate, review and rebuild it with the tools in `scripts/tr/`. For a general overview see the [README](../README.md).

## How the Turkish text was produced

1. **Machine translation.** `scripts/tr/translate_tr.py` sends each word to Claude Haiku 5.5. The model translates from the English definitions and examples. The original Chinese gloss is passed only as a sense hint, never as the source text.
2. **Full AI review.** Every entry was then reviewed by Claude Sonnet 5.5 in chunks (`scripts/tr/review_tool.py`, brief in `scripts/tr/REVIEW_BRIEF.md`). The review corrected 3,343 fields.
3. **Automated QA.** `scripts/tr/qa_tr.py` checks counts, empty fields, leftover CJK text, untranslated examples, length limits and duplicate ids.

This is AI translation reviewed by AI. It has not been proofread by a professional translator, so errors remain likely. Corrections are welcome as issues or pull requests (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## What each word has

- Turkish meanings, one per English sense.
- Turkish translations of both example sentences.
- The Turkish meaning of every collocation.
- A usage tip written for Turkish speakers (TDK spelling, no filler).

Inside the app code the fields are still named `zh` in some places, but in this edition they hold Turkish. In the exported dataset they are named `tr`.

## Where things are

| Path | Contents |
|---|---|
| `data/tr/*.json` | Turkish overlays, one object per word. This is the single source of the Turkish text. |
| `data/source/` | The original English–Chinese data and media flags, used only as input |
| `data/word-atlas-tr.json`, `data/word-atlas-tr.csv` | The exported Turkish–English dataset (CC BY 4.0) |
| `scripts/tr/translate_tr.py` | Translates the words that do not have Turkish yet (Claude API, resumable) |
| `scripts/tr/qa_tr.py` | Validates the overlays and writes `output/qa-tr.md` |
| `scripts/tr/review_tool.py`, `scripts/tr/REVIEW_BRIEF.md` | Chunked review: `show`, `check`, `status`, `apply` |
| `scripts/tr/apply_tr.py` | Merges the overlays and rebuilds `public/atlas/` and the `data/word-atlas-tr.*` files |
| `scripts/tr/gen_voice_tr.py` | Generates the Turkish voice lines with edge-tts (Microsoft tr-TR neural voices, no key needed) |

An overlay object looks like `{"id", "senses": [...], "ex": [..., ...], "col": [...], "tip": "...", "note": "..."}`. The lists line up one to one with the English senses, examples and collocations.

## Translate new or missing words

You need your own Anthropic API key. Keep it in an environment variable, never in a file. The scripts only need Python 3.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python3 scripts/tr/translate_tr.py --sample 60 --dry-run   # show the plan, no API call
python3 scripts/tr/translate_tr.py --sample 60             # 60 words spread over A1..C2, to check quality
python3 scripts/tr/qa_tr.py --review 30                    # checks, plus output/qa-tr.md and output/review-tr.md
python3 scripts/tr/translate_tr.py --workers 4             # translate everything that is missing
```

On Windows PowerShell use `python` instead of `python3`, and set the key with `$env:ANTHROPIC_API_KEY = "sk-ant-..."`.

- The run is resumable: words already in `data/tr/` are skipped.
- The default model is `claude-haiku-5-5`. Change it with `--model` or `TR_MODEL`. `--effort low|medium|high` sets the thinking effort (default `low`). `--limit N` takes the next N words in order instead of `--sample`.
- At the end the script prints token usage and a cost estimate.
- `qa_tr.py` exits with code 1 if it finds errors.

## Review and correct

```bash
python3 scripts/tr/qa_tr.py          # automatic checks
python3 scripts/tr/review_tool.py    # see the usage text for show / check / status / apply
```

`REVIEW_BRIEF.md` is the brief given to reviewers: what a good sense gloss looks like, what to fix, and what to leave alone. Corrections for single words can also be made by editing the matching file in `data/tr/` directly.

## Rebuild the app data

```bash
python3 scripts/tr/apply_tr.py       # merge overlays, rebuild public/atlas/ and data/word-atlas-tr.*
npm run check:atlas
npm test
npm run build
```

## Turkish voice lines

The three spoken clips in `public/sfx/` (`splash-voice.mp3`, `voice-galaxy-hello.mp3`, `voice-galaxy-lit.mp3`) are Turkish. To regenerate them:

```bash
pip install edge-tts
python scripts/tr/gen_voice_tr.py <outdir>
```

The script writes one file per line for each of two voices (Emel and Ahmet). Copy the one you prefer into `public/sfx/`. If `ffmpeg` is available it also matches the loudness.

## Deploy

`.github/workflows/pages.yml` builds the site and publishes it to GitHub Pages on every push to `main`. In the repository open **Settings → Pages** and set **Source** to **GitHub Actions**. The site is then served at `https://<account>.github.io/<repository>/`.
