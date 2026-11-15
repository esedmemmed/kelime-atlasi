# Contributing

Thank you for helping make Kelime Atlası better.

## Correcting entries

Corrections are the most useful contribution. Write the word ID, the problem, and your suggested fix in an Issue (the word-correction template helps), or open a PR directly:

1. Before changing source data, read [docs/pipeline.md](docs/pipeline.md). For a small fix, you can edit the entry in `data/word-atlas-tr.json` and the matching entry in `public/atlas/entries/`, keeping both in sync. Update the matching row in `data/word-atlas-tr.csv` too.
2. Run `python scripts/tr/qa_tr.py`, `npm run check:atlas`, and `npm test`.
3. Explain the reason for the change in the PR. Add a link to an authoritative dictionary when possible.

## Code

- TypeScript in strict mode, React function components, and no new state management or UI framework dependencies.
- Keep the direction: no accounts, local-first, no tracking.
- For visual changes, check light mode, dark mode, and a 375px phone width.
- Before submitting, run `npm test`, `npm run check:atlas`, and `npm run build`.

## New material

When you add images, audio, or text, state the source and license. Only content that can be redistributed under CC BY 4.0 is accepted.

## Security

Do not paste any API key into Issues, PRs, screenshots, or logs. Generation scripts read credentials only from environment variables or from a file outside the repository. See [SECURITY.md](SECURITY.md).
