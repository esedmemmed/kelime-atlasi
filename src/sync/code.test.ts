import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCode, isValidCode, normalizeCode } from "./code";
import { WORDS } from "./words";

test("word list is exactly 1024 unique, simple, frozen words", () => {
  assert.equal(WORDS.length, 1024);
  assert.equal(new Set(WORDS).size, 1024);
  assert.ok(WORDS.every((w) => /^[a-z]{3,6}$/.test(w)));
  assert.ok(Object.isFrozen(WORDS));
  assert.deepEqual([...WORDS], [...WORDS].sort());
  for (const bad of ["kill", "die", "dead", "gun", "war", "sex", "drug", "drunk", "fat", "ugly", "hate", "blood", "bomb"]) assert.ok(!WORDS.includes(bad), bad);
});

test("normalizes separators and case", () => {
  assert.equal(normalizeCode("River Lamp_green-cloud 4821"), "river-lamp-green-cloud-4821");
  assert.equal(normalizeCode("  --River,,Lamp  green---cloud/4821!! "), "river-lamp-green-cloud-4821");
  assert.equal(normalizeCode(""), "");
});

test("validates words and the 4-digit tail", () => {
  const [a, b, c, d] = [WORDS[0], WORDS[1], WORDS[500], WORDS[1023]];
  assert.ok(isValidCode(`${a}-${b}-${c}-${d}-0042`));
  assert.ok(isValidCode(`${a.toUpperCase()} ${b} ${c} ${d} 4821`));
  assert.ok(!isValidCode(`${a}-${b}-${c}-${d}-482`));
  assert.ok(!isValidCode(`${a}-${b}-${c}-${d}-48211`));
  assert.ok(!isValidCode(`${a}-${b}-${c}-4821`));
  assert.ok(!isValidCode(`${a}-${b}-${c}-${d}-${d}-4821`));
  assert.ok(!isValidCode(`${a}-${b}-${c}-zzzzzz-4821`));
  assert.ok(!isValidCode(`${a}-${b}-${c}-${d}-48a1`));
  assert.ok(!isValidCode(""));
});

test("generated codes are always valid and vary", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const c = generateCode();
    assert.ok(isValidCode(c), c);
    assert.equal(normalizeCode(c), c);
    assert.match(c, /-\d{4}$/);
    seen.add(c);
  }
  assert.ok(seen.size > 295);
});
