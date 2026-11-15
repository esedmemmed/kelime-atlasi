# Kelime Atlası: plan for the Turkish–English edition

The goal is a full Turkish–English version of Word Atlas (词光) for Turkish speakers learning English. Nothing Chinese is left in the app, the data or the docs. Everything else comes from the original unchanged: the English content, the 7,298 illustrations, the UK/US audio and the FSRS review.

## 1. What exists today

**The original** (`esedmemmed/word-atlas`, a fork of `designfuchen/word-atlas` with no changes yet) is about 670 MB.
- `public/atlas/`: 37,500 media files (images, thumbnails, UK/US word audio, example audio). They are all English or have no text, so they are reused as-is.
- `data/word-atlas.json` / `.csv`: 7,298 entries. The fields with Chinese are `senses[].zh` (13,733), `ex[].zh` (14,596), the `col` "english｜中文" pairs (24,722), `tip` (7,298), `note` (37) and `syn` (1).
- About 50 code and doc files contain Chinese: `src/**`, `README.md`, `docs/*.md`, `CONTRIBUTING`, `SECURITY`, `CONTENT_LICENSE`, `.github` templates, `scripts/atlas/*`, `package.json`, `index.html` and the manifest.
- Media with Chinese in it:
  - `public/brand/og-card.jpg` has Chinese text. `scripts/render-cards.mjs` re-renders it, along with the banner and screenshots.
  - The `docs/assets/*.jpg|mp4` screenshots and demo video show the Chinese UI.
  - `public/sfx/splash-voice.mp3`, `voice-galaxy-hello.mp3` and `voice-galaxy-lit.mp3` are spoken Chinese. They were made with ElevenLabs.
  - The topic and hero illustrations have no text, so they are fine.

**Your local work** (`D:\World Atlas`, an overlay that unzips over the original):
- About 25 UI files are already translated (`src/pages/*`, `src/ui/*`, `App.tsx`, etc.) and `index.html` is in Turkish.
- 300 words are translated (A1) in `data/tr/sample-*.json`.
- `scripts/tr/translate_tr.py` translates with the Claude API, resumes where it stopped and checks counts. `scripts/tr/apply_tr.py` merges the overlays and rebuilds `public/atlas/index.json` and the entry chunks.
- `.github/workflows/pages.yml` deploys to GitHub Pages.
- Still to do: 6,998 words; app limits that hide untranslated words; the Chinese voice clips; `og-card.jpg`; screenshots; docs; and a few CJK leftovers (`share.ts` CJK tokenizer, `"；"` join, `"　"` full-width blanks in `Learn.tsx`, `词光` in `About.tsx`).

## Decisions (2026-11-15)

- **Repo:** a new standalone repo, `esedmemmed/kelime-atlasi` (not a fork), with the full original history plus the Turkish commits.
- **Translation:** `scripts/tr/translate_tr.py` with `--model claude-haiku-5-5`. You run it with your own `ANTHROPIC_API_KEY` in your terminal; the key never goes into chat or files.
- **Voice clips:** Turkish versions made with edge-tts (a Microsoft tr-TR neural voice), free and with no key.

## 2. Approach

1. **Repository.** Start from a full clone of the original, with its history and attribution. Commit the local overlay on top, then push to the repo you choose (see the decisions below). Work happens on a branch and is merged to `main` at the end.
2. **Translation pipeline.** Keep the existing overlay design. `data/tr/*.json` is the single source of the Turkish text, and `apply_tr.py` builds the app data from it. This is resumable and lets us review the output batch by batch.
3. **Model use.**
   - Opus (me) plans, writes the briefs, reviews the diffs and does the final QA.
   - Sonnet subagents do the code changes: the app fixes, the `zh`→`tr` rename and the scripts.
   - Haiku 5.5 does all bulk translation: the 7k words, plus the docs and README.
   - Sonnet re-checks only the entries the automatic QA flags.

## 3. Phases

| # | Phase | Who | Done when |
|---|---|---|---|
| 0 | Set up the repo: full clone, overlay committed, `npm ci && npm run build` passes, pushed | Opus (git ops) | The repo exists on GitHub and the Pages build is green with 300 words |
| 1 | Pilot: translate 200 words across all CEFR levels (not only A1), then review a sample by hand | Haiku + Opus review | Prompt approved; tune `SYSTEM` if needed |
| 2 | Bulk translate the remaining ~6,800 words in batches of 15. Haiku 5.5 at low effort, optionally via the Batch API (50% off) | Haiku via script | Every id has an overlay, and `apply_tr.py` reports 0 problems |
| 3 | Automatic QA: no CJK left; counts line up; no empty fields; length limits; Turkish characters present; tip not copied from the English. Sonnet re-translates the flagged entries | script + Sonnet | QA report clean |
| 4 | App cleanup: remove the 300-word/CEFR limits (Onboarding, Palette); fix the CJK tokenizer, `"；"` and `"　"`; rename the `zh` fields to `tr` across types, data and UI; update the tests (`text.test.ts`, `typing.test.ts`); `npm test && npm run build` pass | Sonnet | Builds, tests pass, grep finds no CJK in `src/` |
| 5 | Media: Turkish voice for the 3 clips (see decision C); re-render `og-card.jpg`, the banner and the screenshots with `render-cards.mjs`; drop or re-record `demo.mp4`/`launch.mp4` | Sonnet + script | No Chinese in any visible asset |
| 6 | Docs: `README.md` in Turkish and `README.en.md` in English; translate `docs/*.md`, `CONTRIBUTING`, `SECURITY`, `CONTENT_LICENSE`, `.github` templates, `data/README.md`, script comments and prompts; update `package.json` (name `kelime-atlasi`, description, `pack:public` path) | Haiku (text) + Sonnet (scripts) | Full-repo CJK grep is empty, except credit lines that name 词光 on purpose |
| 7 | Release: remove the Chinese source dataset from the shipped tree (keep it only as an input under `data/source/`, or drop it); `check:atlas`, `test` and `build` pass; merge to `main`; Pages deploys; smoke-test the live site in the browser | Opus | The live site works end to end in Turkish |

## 4. Cost estimate (translation)

There are about 7,000 words left. Each word is about 400 input tokens and 500 output tokens (Turkish uses more tokens).
- **Haiku 5.5** ($0.10 / $0.50 per MTok): about 3 MTok in and 3.5 MTok out comes to roughly **$2–4**, or about half that with the Batch API.
- For comparison, Sonnet 5.5 would cost about $40. Re-checking the flagged entries with Sonnet adds roughly $1–3.

## 5. Risks

- **Repo size (~670 MB of media).** The first push takes a while. GitHub's limits are fine: no single file is over 100 MB.
- **Line-up errors** (one Turkish string per English sense, example and collocation). `check()` and `apply_tr.py` already reject mismatches, and the script retries.
- **Tip quality.** The Chinese tips are about Chinese learners' mistakes. The prompt already tells the model to rewrite them for Turkish speakers, and the pilot will confirm this.
- **Licence.** The content is CC BY 4.0, so the original must be credited (on the About page and in the README). The code is MIT.
