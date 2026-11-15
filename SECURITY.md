# Security and privacy

## Where data goes

Kelime Atlası has no accounts, server-side storage, analytics, or tracking. Progress is stored only in the browser's localStorage. It can be exported as a JSON backup from the profile page. When a backup is imported, every field is validated, and malformed data is discarded.

## Credentials

The website does not need any API key. Only the content generation scripts in `scripts/atlas/` and the Turkish layer scripts in `scripts/tr/` that call model services need credentials. They read them from environment variables (`SUB2_BASE_URL`, `SUB2_API_KEY`, `ELEVENLABS_API_KEY`) or from a directory outside the repository (`ATLAS_SECRETS`). Credentials are never written into the repository.

- Do not store credentials in `VITE_*` variables. They are bundled into the browser code.
- Before publishing, run `npm run pack:public`. It exports according to an allowlist and scans for credentials and personal paths. The scan is an aid and does not replace a manual check.
- If a credential is leaked by accident, revoke or rotate it with the provider immediately.

## Reporting a vulnerability

To report a security issue for this repository, open a private security advisory on GitHub (Security → Advisories). Do not post details publicly.
