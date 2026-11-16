import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptDoc, deriveSecrets, encryptDoc, fromBase64 } from "./crypto";

const doc = { v: 1, cards: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`w${i}`, { due: i, s: 1.5 }])), note: "çğış ✓" };

test("derives deterministic secrets of the right shape", async () => {
  const a = await deriveSecrets("river-lamp-green-cloud-4821");
  const b = await deriveSecrets("River Lamp green cloud 4821");
  const c = await deriveSecrets("river-lamp-green-cloud-4822");
  assert.match(a.id, /^[0-9a-f]{32}$/);
  assert.match(a.auth, /^[A-Za-z0-9_-]{22}$/); // 16 bytes, base64url, no padding
  assert.equal(a.id, b.id);
  assert.equal(a.auth, b.auth);
  assert.notEqual(a.id, c.id);
  assert.notEqual(a.auth, c.auth);
  assert.equal((a.key.algorithm as AesKeyAlgorithm).length, 256);
  assert.ok(!a.key.extractable);
});

test("round trips with and without gzip", async () => {
  const { key } = await deriveSecrets("river-lamp-green-cloud-4821");
  const gz = await encryptDoc(doc, key);
  const raw = await encryptDoc(doc, key, { gzip: false });
  assert.deepEqual(await decryptDoc(gz, key), doc);
  assert.deepEqual(await decryptDoc(raw, key), doc);
  const g = fromBase64(gz);
  const r = fromBase64(raw);
  assert.deepEqual([g[0], g[1], r[0], r[1]], [1, 1, 1, 0]);
  assert.ok(gz.length < raw.length, "gzip should shrink repetitive data");
  assert.notEqual(await encryptDoc(doc, key), gz, "fresh IV every time");
});

test("a wrong key or a tampered blob fails", async () => {
  const a = await deriveSecrets("river-lamp-green-cloud-4821");
  const b = await deriveSecrets("river-lamp-green-cloud-4822");
  const blob = await encryptDoc(doc, a.key);
  await assert.rejects(decryptDoc(blob, b.key));
  const bytes = fromBase64(blob);
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(decryptDoc(Buffer.from(bytes).toString("base64"), a.key));
  await assert.rejects(decryptDoc("AAAA", a.key));
});
