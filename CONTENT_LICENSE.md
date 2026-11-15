# Content license

## Code

Source code and UI design are under the [MIT License](LICENSE). Dependencies keep their own licenses. The Fraunces typeface is under the SIL Open Font License 1.1.

## Dataset, illustrations and recordings

The following material is offered under **[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)**, to the extent of the rights the maintainers can grant:

- The dataset files under `data/`, and the meanings, English definitions, example sentences, translations (including the Turkish translations), collocations, word families, synonyms and antonyms, tips, levels and topics in `public/atlas/index.json` and `public/atlas/entries/`;
- Illustrations in `public/atlas/img/`, `public/atlas/thumb/` and `public/brand/`;
- Pronunciation and example sentence recordings in `public/atlas/audio/`.

**Attribution:** `Word Atlas contributors — CC BY 4.0`, with a link to the license and a note on whether changes were made.

### Original work

This edition is adapted from **Word Atlas** by the Word Atlas contributors, published at https://github.com/designfuchen/word-atlas. The original English-Chinese dataset (`data/source/word-atlas.zh.json`), its illustrations and recordings come from that project and keep its attribution.

### Turkish edition

The Turkish translation and the Turkish usage tips are part of the adapted work, published as **Kelime Atlası**: https://github.com/esedmemmed/kelime-atlasi. Turkish translation was produced with Claude Haiku 5.5 and reviewed with Claude Sonnet 5.5, then checked with automated QA. See [docs/turkish-edition.md](docs/turkish-edition.md).

### Notes

- This project claims no exclusive rights over English words or the bare headword list.
- Content was generated with AI models under the project's specifications (text: large language models; illustrations: image models; recordings: ElevenLabs synthetic speech), and the Turkish translation was produced with Claude models. It was checked automatically and by model review, not proofread entry by entry by a human. It is provided as-is without warranty of accuracy.
- The recording license covers the finished audio files only. It does not cover the underlying voice models, voice identities, or any person's likeness or personality rights, and does not imply endorsement by the voice provider. Voices: ElevenLabs "Alice" (UK) and "Sarah" (US).
- The three Turkish voice lines in `public/sfx/` (`splash-voice.mp3`, `voice-galaxy-hello.mp3`, `voice-galaxy-lit.mp3`) were synthesized with Microsoft Edge text-to-speech (voice `tr-TR-EmelNeural`) via `scripts/tr/gen_voice_tr.py`.
- This is not an official IELTS word list and is not affiliated with the IELTS partners.
