# Dataset format

## `data/word-atlas-tr.json`

An array sorted by learning route: CEFR level from easiest to hardest, with topics mixed within each level. Each entry:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | URL-safe unique ID, also used as the media file name, e.g. `principle`, `day-off` |
| `w` | string | Headword (English) |
| `uk` / `us` | string | British / American IPA, with slashes |
| `senses` | `{pos, tr, en}[]` | 1-3 senses: part of speech, Turkish meaning, short English definition |
| `ex` | `{en, tr}[]` | Two original example sentences: `ex[0]` everyday short sentence, `ex[1]` longer IELTS-style sentence. `tr` is the Turkish translation |
| `col` | string[] | Common collocations, format `english|Turkish` |
| `fam` | string[] | Word family, format `word (pos)` |
| `syn` / `ant` | string[] | Synonyms / antonyms |
| `tip` | string | One usage or distinction tip, written in Turkish |
| `cefr` | `A1`...`C2` | Estimated difficulty |
| `topic` | string | One of 19 topics: education, work, technology, science, environment, health, society, government, economy, media, arts, travel, city, nature, daily, emotion, thinking, sport, history |
| `note` | string | Optional usage note (offensive or outdated usage, spelling notes, etc.) |

The original English-Chinese source stays in `data/source/word-atlas.zh.json`. The Turkish edition is built from it and does not replace it.

## `data/word-atlas-tr.csv`

The same content as a table, UTF-8 encoded. Columns:

`id, word, ipa_uk, ipa_us, cefr, topic, meanings_tr, definition_en, example1_en, example1_tr, example2_en, example2_tr, collocations, word_family, synonyms, antonyms, tip_tr`

Multi-value cells use the separators defined in the build script.

## Web data `public/atlas/`

- `index.json`: one compact row per word, with these fields in order: `id, word, tr, ipa, cefr, topic, media`. `media` is a bit flag: `1` illustration, `2` British audio, `4` American audio, `8` example sentence audio.
- `entries/<n>.json`: full entries in blocks of 100. Block `n` covers rows `n*100` to `n*100+99` in the index.
- `img/<id>.webp` (512px) and `thumb/<id>.webp` (256px).
- `audio/uk/<id>.mp3`, `audio/us/<id>.mp3`, and `audio/ex/<id>.mp3` (reading of `ex[0]`).

Media coverage is defined by the `media` bit flags in `index.json`. Do not assume every word has every file.

The app data is generated from the dataset by `python scripts/tr/apply_tr.py`. See [docs/turkish-edition.md](turkish-edition.md) for how the Turkish layer was produced and checked.

## Coverage

- 7,298 words
- 14,596 example sentences (two per word)
- CEFR levels A1 to C2
- 19 topics

## License and attribution

CC BY 4.0. Attribution: "Word Atlas contributors". See [CONTENT_LICENSE.md](../CONTENT_LICENSE.md) for the full attribution, including the original project and the Turkish translation.
