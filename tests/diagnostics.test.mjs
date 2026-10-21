import test from "node:test";
import assert from "node:assert/strict";
import { safeApplicationEvent } from "../scripts/diagnostics.mjs";

test("only structured unexpected API errors expose whitelisted stage and type", () => {
  assert.equal(
    safeApplicationEvent('request_failed {"stage":"chat_quota_reservation","type":"TypeError"}'),
    "request_failed stage=chat_quota_reservation type=TypeError",
  );
  assert.equal(
    safeApplicationEvent('request_failed {"stage":"chat_provider","type":"FirebaseError"}'),
    "request_failed stage=chat_provider type=FirebaseError",
  );
});
test("potential user content and credentials are discarded, never printed", () => {
  assert.equal(safeApplicationEvent('message: PRIVATE_TOKEN user message'), null);
  assert.equal(safeApplicationEvent('request_failed {"stage":"secret","type":"Error","body":"private"}'),
    "request_failed stage=unknown type=Error");
  assert.equal(safeApplicationEvent('request_failed {"stage":"chat_provider","type":"secretKey"}'),
    "request_failed stage=chat_provider type=unknown");
});
test("existing chat stream/lock errors remain privacy-safe", () => {
  assert.equal(safeApplicationEvent("chat_stream_failed { type: 'Error', personal: 'secret' }"),
    "chat_stream_failed details=withheld");
  assert.equal(safeApplicationEvent("chat_lock_release_failed { type: 'Error' }"),
    "chat_lock_release_failed details=withheld");
});
