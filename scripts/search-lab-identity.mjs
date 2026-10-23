import { createHmac } from "node:crypto";
import { appendFileSync } from "node:fs";

export function deriveSearchToken(repositoryToken) {
  if (typeof repositoryToken !== "string" || repositoryToken.length < 20)
    throw new Error("Existing PRIVATE_REPO_TOKEN is missing or invalid.");
  return createHmac("sha256", repositoryToken)
    .update("aster-native-search-test-gateway:v1")
    .digest("hex");
}

if (process.argv[1] && import.meta.url.endsWith("/"+process.argv[1].split("/").at(-1))) {
  const result = deriveSearchToken(process.env.SOURCE_TOKEN);
  if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV required.");
  appendFileSync(process.env.GITHUB_ENV, "ASTER_TOOL_TOKEN="+result+"\n", {mode:0o600});
  // Mask the derived bearer token in any later workflow diagnostics.
  process.stdout.write("::add-mask::"+result+"\n");
  process.stdout.write("AsTeR native search credentials derived from existing checkout secret.\n");
}
