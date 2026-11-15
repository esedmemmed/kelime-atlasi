# Content pipeline

The content and media pipeline lives in `scripts/atlas/`. It is unchanged from the original project, [designfuchen/word-atlas](https://github.com/designfuchen/word-atlas). It produced the original English-Chinese data and all illustrations and audio used by this edition.

The Turkish layer lives in `scripts/tr/`. It is described in [docs/turkish-edition.md](turkish-edition.md).

Credentials are read only from environment variables or from a directory outside the repository (see [SECURITY.md](../SECURITY.md)). Intermediate files are written to `.local/forge/`, which is ignored by Git, so runs can be resumed.

## Original pipeline (`scripts/atlas/`)

1. **Headwords**: `.local/forge/headwords.json`, one item per entry as `{hid, word, raw}`. `raw` is an optional sense hint, used only to decide which senses matter. It is not copied into the output.
2. **Entry text** `gen_text.py`: batches of 10 words, generating JSON under the writing rules in [`gen_text.py`](../scripts/atlas/gen_text.py) (accuracy first, original content, two kinds of example sentences, no invented etymology, safe and neutral wording).
3. **Illustrations** `gen_images.py`: each entry has a scene description `scene`. It is combined with a shared style prompt, generated at 1024px, and compressed to a 768px WebP master. Generated in learning-route order.
4. **Pronunciation** `gen_word_audio.py`: ElevenLabs, British and American voices.
5. **Example audio** `gen_sentence_audio.py`: reads aloud `ex[0]`, in learning-route order.
6. **Compile** `build_atlas.py`: cleans fields, sorts, splits into blocks, and writes `public/atlas/` and `data/`.
7. **Check** `npm run check:atlas`: structure, order, references, and that media files exist.

```bash
export SUB2_BASE_URL=... SUB2_API_KEY=... ELEVENLABS_API_KEY=...
python3 scripts/atlas/gen_text.py --workers 8
python3 scripts/atlas/gen_images.py --workers 8 --follow
python3 scripts/atlas/gen_word_audio.py
python3 scripts/atlas/gen_sentence_audio.py --follow
python3 scripts/atlas/build_atlas.py
npm run check:atlas
```

`SUB2_BASE_URL` can point to any OpenAI-compatible API.

## Turkish layer (`scripts/tr/`)

1. **Machine translation**: Claude Haiku 5.5 translated the Turkish fields of each entry.
2. **Review**: Claude Sonnet 5.5 reviewed the full translation. The review corrected 3,343 fields.
3. **QA** `scripts/tr/qa_tr.py`: automated checks on the translated data.
4. **Apply** `scripts/tr/apply_tr.py`: writes the Turkish data into `public/atlas/index.json` and `public/atlas/entries/*.json`.
5. **Check** `npm run check:atlas`.

## Quality boundary

Automated checks cover structure, fields, order, and files. They do not cover semantic correctness. Neither the illustrations nor the example sentences were proofread entry by entry, and the Turkish translation was checked by a model review and automated QA, not a full human review. Report problems as an Issue or a PR.
