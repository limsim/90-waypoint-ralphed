import test from "node:test";
import assert from "node:assert/strict";
import { APP_NAME } from "../src/domain/scaffold.js";

// Trivial placeholder test (US-001): proves the build -> headless-test pipeline is
// wired end to end and that tests can import compiled domain (core) output. Real
// domain test suites arrive with US-002 onward.
test("scaffold: build + test pipeline is wired", () => {
  assert.equal(APP_NAME, "90 Waypoint Map");
});
