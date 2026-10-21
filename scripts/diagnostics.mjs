const safeStages = new Set([
  "routing", "authentication", "chat_validation", "chat_plan_lookup",
  "chat_quota_reservation", "chat_history", "chat_provider",
]);
const safeTypes = new Set([
  "Error", "TypeError", "RangeError", "SyntaxError",
  "ReferenceError", "FirebaseError", "FirebaseAuthError",
  "AbortError", "DOMException", "unknown",
]);

// Never forward raw application stderr to the public Actions log. It could
// contain user messages, credentials, provider responses, or account metadata.
export function safeApplicationEvent(line) {
  const value = String(line || "").trim();
  const match = /^request_failed\s+(\{.{0,512}\})$/.exec(value);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      const stage = safeStages.has(data.stage) ? data.stage : "unknown";
      const type = safeTypes.has(data.type) ? data.type : "unknown";
      return `request_failed stage=${stage} type=${type}`;
    } catch {
      return "request_failed stage=unknown type=unknown";
    }
  }
  const providerMatch = /^provider_http_failure\\s+(\\{.{0,512}\\})$/.exec(value);
  if (providerMatch) {
    try {
      const data = JSON.parse(providerMatch[1]);
      const allowedModels = new Set(["mi-large", "mi-plus", "mi-ax", "atmig", "atmig-plus"]);
      const model = allowedModels.has(data.model) ? data.model : "unknown";
      const status = Number.isInteger(data.status) && data.status >= 400 && data.status <= 599
        ? data.status : 0;
      return `provider_http_failure model=${model} status=${status}`;
    } catch {
      return "provider_http_failure model=unknown status=0";
    }
  }
  if (/^chat_stream_failed(?:\s|$)/.test(value)) {
    return "chat_stream_failed details=withheld";
  }
  if (/^chat_lock_release_failed(?:\s|$)/.test(value)) {
    return "chat_lock_release_failed details=withheld";
  }
  return null;
}
