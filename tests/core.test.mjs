import test from "node:test";
import assert from "node:assert/strict";
import {
  JOB_MAX_MINUTES, DISPATCH_AT_MINUTES, DRAIN_AT_MINUTES,
  parsePositiveInt, normalizeOrigin, deploymentEnvironment,
  isActive, shouldDispatch, shouldDrain, validateGeneration
} from "../scripts/core.mjs";

test("handover is requested with forty minutes of nominal overlap", () => {
  assert.equal(JOB_MAX_MINUTES, 355);
  assert.equal(DISPATCH_AT_MINUTES, 315);
  assert.equal(JOB_MAX_MINUTES - DISPATCH_AT_MINUTES, 40);
  assert.equal(DRAIN_AT_MINUTES, 350);
  assert.equal(shouldDispatch(314.9, false), false);
  assert.equal(shouldDispatch(315, false), true);
  assert.equal(shouldDispatch(315, true), false);
  assert.equal(shouldDispatch(350, false), false);
  assert.equal(shouldDrain(349.9), false);
  assert.equal(shouldDrain(350), true);
});

test("initial generation derives its own run ID", () => {
  assert.deepEqual(validateGeneration("", "1", "", "12345"), {
    chain: "12345", generation: 1, parent: ""
  });
});

test("continuation generation requires valid parent and chain", () => {
  assert.deepEqual(validateGeneration("12345", "2", "12345", "12346"), {
    chain: "12345", generation: 2, parent: "12345"
  });
  assert.throws(() => validateGeneration("", "2", "", "12346"));
  assert.throws(() => validateGeneration("12345", "2", "12346", "12346"));
  assert.throws(() => validateGeneration("999", "1", "", "12346"));
});

test("deployment names separate chains and generations", () => {
  assert.equal(deploymentEnvironment("12345", 3), "aster-host-12345-gen-3");
  assert.notEqual(deploymentEnvironment("12345", 2), deploymentEnvironment("12345", 3));
  assert.throws(() => deploymentEnvironment("bad", 3));
});

test("watchdog considers queued and running jobs active", () => {
  for (const status of ["queued", "in_progress", "waiting", "requested", "pending"]) {
    assert.equal(isActive({status}), true);
  }
  assert.equal(isActive({status: "completed"}), false);
  assert.equal(isActive(undefined), false);
});

test("public URL must be an HTTPS origin only", () => {
  assert.equal(normalizeOrigin("https://chat.example.com"), "https://chat.example.com");
  assert.throws(() => normalizeOrigin("http://chat.example.com"));
  assert.throws(() => normalizeOrigin("https://chat.example.com/some/path"));
  assert.throws(() => normalizeOrigin("https://user:pass@chat.example.com"));
  assert.throws(() => normalizeOrigin("https://chat.example.com/?token=1"));
});

test("numeric validation rejects zero, negatives and malformed inputs", () => {
  assert.equal(parsePositiveInt("1", "generation"), 1);
  assert.throws(() => parsePositiveInt("0", "generation"));
  assert.throws(() => parsePositiveInt("-1", "generation"));
  assert.throws(() => parsePositiveInt("1abc", "generation"));
});
