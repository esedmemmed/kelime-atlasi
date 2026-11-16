# Security and privacy

## Where data goes

Kelime Atlası has no accounts, analytics, or tracking. Progress is stored in the browser's localStorage. It can be exported as a JSON backup from the profile page. When a backup is imported, every field is validated, and malformed data is discarded.

**Optional cross-device sync** (Profile → "Cihazlarımı eşitle") is off until the learner turns it on, and it is end-to-end encrypted:

- The sync code never leaves the device. The app derives three things from it: a random-looking id, an access token, and an AES-GCM-256 key.
- The server (a Cloudflare Worker with D1, in `sync-worker/`) stores only the id, a SHA-256 hash of the token, and an encrypted blob. It cannot read progress.
- The QR code carries the sync code in the URL fragment (`#/sync?c=…`). Browsers never send that part to a server.
- Data that hasn't been updated for 400 days is deleted automatically. A learner can delete their sync data at any time from the profile page.

See [docs/sync.md](docs/sync.md) for the full design.

## Credentials

The website does not need any API key. Only scripts that call model services need credentials, and they read them from environment variables:

- `scripts/tr/translate_tr.py` uses `ANTHROPIC_API_KEY`.
- The original content pipeline in `scripts/atlas/` uses `SUB2_BASE_URL`, `SUB2_API_KEY` and `ELEVENLABS_API_KEY`, or a directory outside the repository (`ATLAS_SECRETS`).

Credentials are never written into the repository.

- Do not store credentials in `VITE_*` variables. They are bundled into the browser code.
- Do not commit `.env` files (they are gitignored), and check `git diff` before pushing.
- If a credential is leaked by accident, revoke or rotate it with the provider immediately.

## Reporting a vulnerability

To report a security issue for this repository, open a private security advisory on GitHub (Security → Advisories). Do not post details publicly.
