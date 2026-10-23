import test from "node:test";
import assert from "node:assert/strict";
import { deriveSearchToken } from "../scripts/search-lab-identity.mjs";
import { makeRegistry, verifyRegistry, validQuickTunnel } from "../scripts/search-lab-registry.mjs";

test("both workflow runners derive a deterministic scoped bearer key without revealing PAT", () => {
  const pat = "test-only-existing-private-repo-secret-not-a-real-credential";
  const key = deriveSearchToken(pat);
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, deriveSearchToken(pat));
  assert.notEqual(key, pat);
  assert.notEqual(key, deriveSearchToken(pat+"rotated"));
  assert.throws(() => deriveSearchToken("short"),/missing or invalid/);
});
test("temporary endpoints require strict HTTPS Cloudflare dev host",()=>{
  assert.equal(validQuickTunnel("https://spring-field-123.trycloudflare.com"),true);
  for(const url of [
    "http://spring-field-123.trycloudflare.com",
    "https://trycloudflare.com", "https://trycloudflare.com.evil.org",
    "https://127.0.0.1","https://localhost","https://attacker.org",
    "https://spring-field-123.trycloudflare.com/v1/search",
    "https://spring-field-123.trycloudflare.com/?redirect=bad",
  ]) assert.equal(validQuickTunnel(url),false,url);
});
test("signed registry accepts live session but rejects tampering, timeout and wrong key",()=>{
  const now=1_800_000_000_000, token="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const entry=makeRegistry({runId:"39912345678",endpoint:"https://test-bridge-123.trycloudflare.com",now,token});
  assert.equal(verifyRegistry(entry,token,now),true);
  assert.equal(verifyRegistry(entry,token,now+350*60*1000+1),false);
  assert.equal(verifyRegistry(entry,"invalid-authentication-key",now),false);
  assert.equal(verifyRegistry({...entry,endpoint:"https://evil.example.com"},token,now),false);
  assert.equal(verifyRegistry({...entry,runId:"39912345679"},token,now),false);
  const stopped=makeRegistry({runId:"39912345678",endpoint:"",now:now+3_000,token,status:"offline"});
  assert.equal(verifyRegistry(stopped,token,now+3_000),false);
});
