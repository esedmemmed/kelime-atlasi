// Run with `npm test`. Starts `wrangler dev --local` unless SYNC_URL is set.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.SYNC_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1", NO_COLOR: "1" };
const ORIGIN = "http://localhost:5188";
let child;

function killChild() {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGKILL");
}
process.on("exit", killChild);

const hex = () => randomBytes(16).toString("hex");
const tok = () => randomBytes(16).toString("base64url");
const call = (id, method, token, headers = {}, body) =>
  fetch(`${BASE}/v1/sync/${id}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

before(async () => {
  const schema = spawnSync("npm run db:local", { cwd: root, env, shell: true, encoding: "utf8" });
  assert.equal(schema.status, 0, `db:local failed:\n${schema.stdout}\n${schema.stderr}`);
  if (!process.env.SYNC_URL) {
    const bin = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
    child = spawn(process.execPath, [bin, "dev", "--local", "--port", "8787"], { cwd: root, env, stdio: "ignore" });
  }
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/v1/health`)).ok) return;
    } catch {}
    if (child && child.exitCode !== null) throw new Error("wrangler dev exited early");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("worker did not become healthy");
});
after(killChild);

test("health", async () => {
  const r = await fetch(`${BASE}/v1/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("full lifecycle", async () => {
  const id = hex(), t = tok();
  let r = await call(id, "PUT", t, { "If-None-Match": "*" }, { data: "AAAA" });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).rev, 1);

  r = await call(id, "PUT", t, { "If-None-Match": "*" }, { data: "BBBB" });
  assert.equal(r.status, 412);

  r = await call(id, "GET", t);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("etag"), '"1"');
  const body = await r.json();
  assert.equal(body.rev, 1);
  assert.equal(body.data, "AAAA");
  assert.equal(typeof body.updated, "number");

  r = await call(id, "GET", t, { "If-None-Match": '"1"' });
  assert.equal(r.status, 304);

  r = await call(id, "GET", tok());
  assert.equal(r.status, 401);
  r = await call(id, "GET", null);
  assert.equal(r.status, 401);

  r = await call(id, "PUT", t, { "If-Match": '"1"' }, { data: "CCCC" });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).rev, 2);

  r = await call(id, "PUT", t, { "If-Match": '"1"' }, { data: "DDDD" });
  assert.equal(r.status, 412);
  assert.equal((await r.json()).rev, 2);

  r = await call(id, "PUT", tok(), { "If-Match": '"2"' }, { data: "EEEE" });
  assert.equal(r.status, 401);

  r = await call(id, "PUT", t, {}, { data: "FFFF" });
  assert.equal(r.status, 400);
  r = await call(id, "PUT", t, { "If-Match": '"2"' }, "not json");
  assert.equal(r.status, 400);

  r = await call(id, "DELETE", tok());
  assert.equal(r.status, 401);
  r = await call(id, "DELETE", t);
  assert.equal(r.status, 204);
  r = await call(id, "GET", t);
  assert.equal(r.status, 404);
  r = await call(id, "DELETE", t);
  assert.equal(r.status, 404);
});

test("unknown id is 404", async () => {
  const r = await call(hex(), "GET", tok());
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, "not_found");
});

test("bad id is 404", async () => {
  for (const id of ["abc", "G".repeat(32), hex().toUpperCase(), hex() + "0"]) {
    assert.equal((await call(id, "GET", tok())).status, 404, id);
  }
});

test("oversize is 413, limit exactly is accepted", async () => {
  const id = hex(), t = tok();
  let r = await call(id, "PUT", t, { "If-None-Match": "*" }, { data: "A".repeat(1_000_001) });
  assert.equal(r.status, 413);
  r = await call(id, "PUT", t, { "If-None-Match": "*" }, { data: "A".repeat(1_000_000) });
  assert.equal(r.status, 201);
  await call(id, "DELETE", t);
});

test("CORS preflight from an allowed origin", async () => {
  const r = await fetch(`${BASE}/v1/sync/${hex()}`, {
    method: "OPTIONS",
    headers: { Origin: ORIGIN, "Access-Control-Request-Method": "PUT" },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(r.headers.get("vary") ?? "", /Origin/);
  assert.equal(r.headers.get("access-control-allow-methods"), "GET, PUT, DELETE, OPTIONS");
  assert.match(r.headers.get("access-control-allow-headers") ?? "", /If-Match/);
  assert.match(r.headers.get("access-control-allow-headers") ?? "", /If-None-Match/);
  assert.equal(r.headers.get("access-control-max-age"), "86400");
});

test("CORS headers on real responses, ETag exposed", async () => {
  const r = await fetch(`${BASE}/v1/sync/${hex()}`, { headers: { Origin: ORIGIN, Authorization: `Bearer ${tok()}` } });
  assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(r.headers.get("access-control-expose-headers"), "ETag");
});

test("disallowed origin gets no ACAO header", async () => {
  for (const method of ["OPTIONS", "GET"]) {
    const r = await fetch(`${BASE}/v1/health`, { method, headers: { Origin: "https://evil.example" } });
    assert.equal(r.headers.get("access-control-allow-origin"), null, method);
  }
});
