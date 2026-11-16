import assert from "node:assert/strict";
import { test } from "node:test";
import { joinLinkFor } from "./link";

const PAGES = "https://esedmemmed.github.io/kelime-atlasi/#/sync?c=CODE";

test("keeps the GitHub Pages sub-path with a relative base", () => {
  assert.equal(joinLinkFor("https://esedmemmed.github.io/kelime-atlasi/#/me", "./", "CODE"), PAGES);
});
test("drops index.html", () => {
  assert.equal(joinLinkFor("https://esedmemmed.github.io/kelime-atlasi/index.html#/me", "./", "CODE"), PAGES);
});
test("works on localhost with an absolute base", () => {
  assert.equal(joinLinkFor("http://localhost:5188/#/me", "/", "CODE"), "http://localhost:5188/#/sync?c=CODE");
});
test("drops the query string of the current page", () => {
  assert.equal(joinLinkFor("https://esedmemmed.github.io/kelime-atlasi/?x=1#/me", "./", "CODE"), PAGES);
});
