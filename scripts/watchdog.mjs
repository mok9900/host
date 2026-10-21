import { isActive } from "./core.mjs";
const repo = process.env.GITHUB_REPOSITORY || "";
const token = process.env.GH_TOKEN || "";
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !token) {
  throw new Error("GitHub repository or token is missing.");
}
const api = "https://api.github.com/repos/" + repo;
async function github(path, method = "GET", body) {
  const response = await fetch(api + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Host watchdog API failed (HTTP " + response.status + ").");
  return response.status === 204 ? null : response.json();
}
const runs = await github("/actions/workflows/host.yml/runs?per_page=100");
const active = (runs.workflow_runs || []).filter(isActive);
if (active.length) {
  console.log(active.length + " active host workflow(s); watchdog will not create another.");
} else {
  console.log("No active host workflow; requesting a fresh initial runner.");
  await github("/actions/workflows/host.yml/dispatches", "POST", {
    ref: "main",
    inputs: {chain: "", generation: "1", parent: ""},
  });
  console.log("Fresh host runner requested. Startup is not yet confirmed.");
}
