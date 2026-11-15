import assert from "node:assert/strict";
import { test } from "node:test";
import { foldTr, gap, lowerTr, normalize, splitHighlight, splitPair } from "./text";

test("highlights the headword and common inflections", () => {
  assert.deepEqual(splitHighlight("Training with a friend motivates me.", "motivate")?.[1], "motivates");
  assert.deepEqual(splitHighlight("She studied hard.", "study")?.[1], "studied");
  assert.deepEqual(splitHighlight("We got a day off today.", "day off")?.[1], "day off");
  assert.equal(splitHighlight("Nothing here.", "salt"), null);
});

test("does not match inside longer unrelated words", () => {
  assert.equal(splitHighlight("The cartoon was funny.", "art"), null);
});

test("gaps the sentence for cloze questions", () => {
  const g = gap("I refused the extra money as a matter of principle.", "principle");
  assert.equal(g?.hidden, "principle");
  assert.equal(g?.after, ".");
});

test("normalizes typography from mobile keyboards", () => {
  assert.equal(normalize("  Don’t  "), "don't");
  assert.deepEqual(splitPair("in principle|ilke olarak"), { en: "in principle", tr: "ilke olarak" });
  assert.deepEqual(splitPair("in principle\uFF5Cilke olarak"), { en: "in principle", tr: "ilke olarak" });
});

test("Turkish-aware lowercasing and diacritic folding", () => {
  assert.equal(lowerTr("IŞIK İLE"), "ışık ile");
  assert.equal(foldTr("Kütüphane"), "kutuphane");
  assert.equal(foldTr("ÇAĞRI ŞÖYLE ÜÇ"), "cagri soyle uc");
  assert.equal(foldTr("ığdır IĞDIR İzmir"), "igdir igdir izmir");
  assert.equal(foldTr("LIBRARY"), "library");
});
