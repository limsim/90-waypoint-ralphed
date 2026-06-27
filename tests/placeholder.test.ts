import test from "node:test";
import assert from "node:assert/strict";

import { DOMAIN_READY } from "../src/domain/placeholder.js";

test("toolchain is wired: domain code is reachable from a headless node:test", () => {
  assert.equal(DOMAIN_READY, true);
});
