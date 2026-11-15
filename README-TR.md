# Kelime Atlası — Turkish edition of Word Atlas

This is an English–Turkish version of [Word Atlas](https://github.com/designfuchen/word-atlas) for Turkish speakers learning English.

## What's included

- **The whole app is in Turkish**: all menus, buttons and messages, plus Turkish dates, greetings and topic names. The app is renamed *Kelime Atlası*.
- **300 words are translated** (the first 300 on the learning path, all CEFR A1). Each one has Turkish meanings, translations of both example sentences, the Turkish meaning of each collocation, and a usage tip written for Turkish speakers.
- **Search** finds words by their English spelling or by their Turkish meaning (`kütüphane` → *library*).
- **Onboarding** only offers the CEFR levels that have translated words.
- The English content, illustrations and UK/US audio come unchanged from the original.

Until the other 6,998 words are translated, the app shows only the 300 translated ones.

## Run it

```bash
git clone https://github.com/designfuchen/word-atlas.git
cd word-atlas
unzip -o ../kelime-atlasi-tr.zip      # unpack these files over the original
npm ci
npm run dev                           # open the address it prints
```

## Translate the remaining words

The translation uses the Claude API, so you need your own API key. The script only needs Python 3.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python3 scripts/tr/translate_tr.py --model claude-haiku-5-5 --limit 200    # test a small batch first and check the Turkish
python3 scripts/tr/translate_tr.py --model claude-haiku-5-5 --workers 4    # then translate everything
python3 scripts/tr/apply_tr.py                    # rebuild the app data
npm run check:atlas && npm run build
```

- You can stop the translation and run it again; words already in `data/tr/` are skipped.
- The default model is `claude-sonnet-5-5`. You can change it with `--model` or the `TR_MODEL` environment variable.
- The translation works from the English definitions and examples. The original Chinese tip is passed along only as a hint.

## Where things are

| Path | Contents |
|---|---|
| `data/tr/*.json` | Turkish overlays, one object per word |
| `data/source/` | The original English–Chinese data and media flags, used as the source |
| `scripts/tr/apply_tr.py` | Merges the overlays and writes `public/atlas/` and `data/word-atlas-tr.{json,csv}` |
| `scripts/tr/translate_tr.py` | Translates the words that don't have Turkish yet |

Inside the app the data fields are still named `zh`, but in this edition they hold Turkish. That way the original code needed no changes there.

## Publish it

`.github/workflows/pages.yml` builds the site and publishes it to GitHub Pages every time you push to `main`. In your GitHub repository, open **Settings → Pages** and set **Source** to **GitHub Actions**. If the repository is a fork, also open the **Actions** tab once and enable workflows. The site will be at `https://<your-account>.github.io/<repo-name>/`.

## License

The code is MIT and the content is CC BY 4.0 (© Word Atlas contributors). This edition adapts the original and credits it on the About page.
