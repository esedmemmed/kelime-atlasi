# Cross-device sync (design and protocol)

Optional sync is end-to-end encrypted. A learner turns it on once and gets a **sync code** plus a **QR code**. They scan the QR code (or type the code) on another device, and from then on progress syncs in the background. There are no accounts or emails, and the server only stores encrypted blobs.

This document is the contract between the server (`sync-worker/`) and the app (`src/sync/`). Change both sides together.

## 1. Sync code and derived secrets

- **Code format:** four English words from the fixed list in `src/sync/words.ts`, followed by a 4-digit number, all joined by `-`. Example: `river-lamp-green-cloud-4821`.
  - The list has exactly 1024 words: lowercase a–z, 3–6 letters, unique, simple A1/A2 headwords.
  - Entropy is 4×10 bits + log2(10000) ≈ 53 bits.
  - **The word list must never change after release.**
- **Normalize before use:** trim, lowercase, replace every run of non-`[a-z0-9]` characters with `-`, and trim `-` from both ends. `River Lamp_green-cloud 4821` must normalize to `river-lamp-green-cloud-4821`.
  - A code is valid only if it has 4 known words followed by exactly 4 digits.
- **Derivation:** run PBKDF2-HMAC-SHA256 over the normalized code with salt `"kelime-atlasi-sync-v1"` and 150 000 iterations, producing 512 bits (64 bytes):
  - bytes 0–15 → `id`, as 32 lowercase hex characters (the server key);
  - bytes 16–31 → `auth`, as base64url without padding (the bearer token);
  - bytes 32–63 → `key`, an AES-GCM-256 key (never leaves the device).
- **Server side:** the server stores `auth_hash` = hex(SHA-256(UTF-8 bytes of the `auth` string)) and compares in constant time.

## 2. Encrypted payload

- `plaintext` = UTF-8 JSON of the **sync document** (section 4).
- Compress with gzip via `CompressionStream("gzip")` when available. If it isn't, store uncompressed and set flag byte 0.
- `blob` = `[1 byte version = 1][1 byte flags: 1 = gzip, 0 = raw][12-byte random IV][AES-GCM ciphertext + tag]`, base64-encoded with the standard alphabet and padding.
- **Limits:** the server rejects `data` longer than 1 000 000 characters with 413. The client must also refuse to upload more than that.

## 3. HTTP API (Cloudflare Worker + D1)

**Base URL:** `VITE_SYNC_URL` (e.g. `https://kelime-atlasi-sync.<account>.workers.dev`). The resource is `/v1/sync/:id`, where `id` is 32 lowercase hex characters (anything else → 404).

**Every request:**
- Sends `Authorization: Bearer <auth>`. A missing or wrong token gets **401** (also when the id doesn't exist yet on GET; see below).
- **CORS:**
  - If `Origin` is in the env var `ALLOWED_ORIGINS` (comma-separated), reply with `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`.
  - Allow methods `GET, PUT, DELETE, OPTIONS` and headers `Authorization, Content-Type, If-Match, If-None-Match`.
  - Expose `ETag`. Set `Access-Control-Max-Age: 86400`.
  - `OPTIONS` returns 204.

| Request | Responses |
|---|---|
| `GET /v1/sync/:id` with optional `If-None-Match: "<rev>"` | **200** `{"rev": n, "data": "<blob>", "updated": ms}` + `ETag: "<rev>"` · **304** when the rev matches · **404** when there is no row · **401** when the row exists but auth doesn't match |
| `PUT /v1/sync/:id`, body `{"data": "<blob>"}`, with **either** `If-None-Match: *` (create) **or** `If-Match: "<rev>"` (update) | **201** `{"rev": 1, "updated": ms}` on create · **200** `{"rev": n+1, "updated": ms}` on update · **412** `{"rev": current}` when the rev doesn't match, or on create when the row already exists · **401** · **413** · **400** for a malformed body or missing precondition header |
| `DELETE /v1/sync/:id` | **204** · **401** · **404** |
| `GET /v1/health` | **200** `{"ok": true}` |

**Updates are atomic:** `UPDATE sync SET data=?, rev=rev+1, updated=? WHERE id=? AND rev=? AND auth_hash=?`. Zero changed rows means 401 or 412 (look the row up to tell which).

**D1 schema** (`sync-worker/schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS sync (
  id TEXT PRIMARY KEY,
  auth_hash TEXT NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_updated ON sync(updated);
```

**Cleanup:** a daily cron trigger deletes rows whose `updated` is older than 400 days.

**Errors:** all error bodies are `{"error": "<code>"}` JSON. The Worker never logs request bodies or tokens.

## 4. Sync document (plaintext JSON, `v: 1`)

```ts
interface SyncDoc {
  v: 1;
  datasetId: string;                       // must equal the local dataset id, otherwise ignore the doc
  updated: number;                         // ms, when this doc was written
  cards: Record<string, CardState>;        // FSRS card states (src/store/srs.ts)
  bookmarks: Record<string, number>;       // word id -> last toggle time; positive = bookmarked, negative = removed (abs = time)
  mistakes: string[];                      // newest first, deduped, capped like Progress.mistakes
  typing: TypingRound[];                   // union by `at`+`mode`, newest first, capped at 200
  devices: Record<string, {                // per-device data that must not be merged by max/union
    name: string;                          // e.g. "Windows · Edge", "iPhone · Safari"
    updated: number;
    days: Record<string, DayStat>;         // that device's own daily stats
  }>;
  settings: Partial<Settings>;             // last writer's learning settings (only used when a device joins)
}
```

**Merge rules** (`merge(local, remote)` is pure, deterministic, commutative where possible, and fully unit-tested):

- **Cards:** for each id, take the side with the larger `last` (a missing `last` counts as 0). On a tie, take the larger `reps`, then the larger `due`. In the result, `seen` = the min of both `seen` values.
- **Bookmarks:** for each id, the entry with the larger `abs(time)` wins. The local `Progress.bookmarks` list = ids with a positive value, in the existing order, with new ones appended.
- **Mistakes:** local first, then remote, deduped, capped.
- **Typing:** union by key `at|mode`, sorted newest first, capped at 200.
- **Devices:** per device id, the entry with the larger `updated` wins. The own device entry is always rebuilt from local `Progress.days`.
- **Stats in the UI:** daily stats = own `Progress.days` + the `days` of every other device, summed field by field per date. Streaks, the week chart and the Today/Me totals must use this combined view.
- **Settings:** copied into the local settings only when a device **joins** an existing code (only `accent, autoplay, dailyNew, retention, spell, startLevel, onboarded`). After that, settings stay per device.
- **Active session:** never synced. After merging remote cards in, every step of the local active session that comes after the current index is removed when that word's merged card has `last > session.started` and that review came from remote. A word reviewed on another device in the meantime is not asked again.

## 5. Client behaviour (`src/sync/engine.ts`)

**Local state** in localStorage key `word-atlas:sync`:

```ts
{ code, id, rev, lastSync, lastError?, deviceId, deviceName, enabled: true }
```

**Push** (only when local progress changed since the last successful sync):
1. Pull with `If-None-Match` and merge.
2. Encrypt and `PUT` with `If-Match` (or `If-None-Match: *` when creating).
3. On 412, pull, merge and retry, at most twice.

**When:**
- **Push:** throttled to at most once per 45 s while the learner is active (trailing), immediately when a learning session finishes, and on `visibilitychange → hidden` / `pagehide`. On hide, use `fetch(..., { keepalive: true })`; if the blob is too big for keepalive (more than 60 kB), just try a normal fetch.
- **Pull:** on app start, on `visibilitychange → visible` and window `focus`, before a learning session starts, and every 120 s while the page is visible. Skip a pull if one finished less than 20 s ago. Use `If-None-Match`, so a 304 is cheap.
- **Errors:** on a network error, 429 or 5xx, back off exponentially (30 s → 10 min). 401 or 404 on an enabled code means the code was removed: stop syncing and show "Eşitleme kodu artık geçerli değil".
- **Offline:** progress always stays in localStorage first. Sync never blocks the UI.

**Flows:**
- **Create** ("Eşitlemeyi aç"): generate a code with `crypto.getRandomValues`, derive the secrets, `PUT If-None-Match: *` with the local doc, then show the QR code and the code.
- **Join** (type a code, or open `…/#/sync?c=<code>`, where the fragment is never sent to any server):
  1. Normalize and validate the code, then derive the secrets.
  2. `GET`. On 404, show "Bu kod bulunamadı".
  3. Merge remote into local (nothing is lost), adopt the settings, then push.
  4. Confirm with "Bu cihaz eşitlendi".
- **Turn off on this device:** delete the local sync state. Progress stays on the device and the server data is untouched.
- **Delete from server** (only behind a confirm): `DELETE`, then turn off. Other devices will get 404 and stop.

## 6. Configuration

- **Front end:** `VITE_SYNC_URL`, read in `src/config.ts` as `SYNC_URL`. When it is empty, all sync UI is hidden and the engine does nothing.
- **GitHub Pages build:** reads the repository variable `SYNC_URL` (`${{ vars.SYNC_URL }}`).
- **Worker:** `sync-worker/wrangler.toml` sets `ALLOWED_ORIGINS = "https://esedmemmed.github.io,http://localhost:5188,http://localhost:5199"`.
