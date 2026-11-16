# Kelime Atlası sync server

A small Cloudflare Worker + D1 database that stores end-to-end encrypted sync blobs. The protocol is defined in [`../docs/sync.md`](../docs/sync.md) (section 3). Everything here is free-tier friendly and needs no accounts or emails for learners.

## One-time setup and deploy (owner)

```
cd sync-worker
npm install
npx wrangler login
npm run setup      # creates the D1 database, writes its id into wrangler.toml, applies schema.sql
npm run deploy
```

`npm run setup` is safe to run again. Commit the updated `wrangler.toml` afterwards (the database id is not a secret).

## Worker URL

`npm run deploy` prints `https://kelime-atlasi-sync.<account>.workers.dev`. You can also find it in the Cloudflare dashboard under Workers & Pages. Put that URL in the GitHub repository variable `SYNC_URL` (it becomes `VITE_SYNC_URL` in the Pages build). Check it with `<url>/v1/health`, which returns `{"ok": true}`.

## Allowed origins (CORS)

Edit `ALLOWED_ORIGINS` (comma-separated, exact origins, no trailing slash) under `[vars]` in `wrangler.toml`, then run `npm run deploy`.

## Local development

```
npm install
npm run db:local   # applies schema.sql to the local D1 (.wrangler/)
npm run dev        # http://localhost:8787
npm test           # applies the schema, starts a local worker, runs the API tests
```

Set `SYNC_URL` to test against an already running worker instead of starting one. Nothing here logs in to Cloudflare.

## Free tier notes

The Workers free plan allows 100 000 requests per day and D1 free includes 5 GB storage and 5 million rows read per day, far more than a learner app needs. Rows not updated for 400 days are deleted by a daily cron (03:17 UTC). See [`../docs/sync.md`](../docs/sync.md) for limits (1 MB per blob) and design.
