import { spawn } from "node:child_process";
import { safeApplicationEvent } from "./diagnostics.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  normalizeOrigin, validateGeneration, deploymentEnvironment,
  isActive, shouldDispatch, shouldDrain
} from "./core.mjs";

const env = process.env;
const repo = env.GITHUB_REPOSITORY || "";
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Invalid GitHub repository.");
const apiBase = "https://api.github.com/repos/" + repo;
const runId = String(env.GITHUB_RUN_ID || "");
const state = validateGeneration(
  String(env.HOST_CHAIN || ""), String(env.HOST_GENERATION || "1"),
  String(env.HOST_PARENT || ""), runId
);
const origin = normalizeOrigin(env.ASTER_PUBLIC_URL);
const startedMs = Number(env.HOST_STARTED_MS);
if (!Number.isFinite(startedMs) || startedMs > Date.now() || Date.now() - startedMs > 45 * 60_000) {
  throw new Error("Invalid runner start timestamp.");
}
if (!env.GH_TOKEN || !env.CLOUDFLARE_TUNNEL_TOKEN) {
  throw new Error("Missing GitHub runtime or tunnel credentials.");
}
let app;
let tunnel;
let deploymentId;
let stopping = false;
let startupStage = "bootstrap";
process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });

async function github(path, method = "GET", body) {
  const response = await fetch(apiBase + path, {
    method,
    headers: {
      Authorization: "Bearer " + env.GH_TOKEN,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("GitHub API request failed (HTTP " + response.status + ").");
  return response.status === 204 ? null : response.json();
}

async function healthy(url) {
  try {
    const response = await fetch(url, {signal: AbortSignal.timeout(5000)});
    return response.ok;
  } catch {
    return false;
  }
}

function elapsedMinutes() {
  return (Date.now() - startedMs) / 60_000;
}

async function waitUntilHealthy(url, child, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  while (!stopping && Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    if (await healthy(url)) return;
    await sleep(1500);
  }
  throw new Error(description + " failed readiness.");
}

function attachSafeDiagnostics(child) {
  let pending = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", chunk => {
    pending += String(chunk);
    if (pending.length > 8192) {
      pending = "";
      return;
    }
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      const safe = safeApplicationEvent(line);
      if (safe) console.error("[AsTeR app] " + safe);
    }
  });
}
function sanitizedEnv() {
  const result = {};
  for (const key of ["PATH", "HOME", "LANG", "TMPDIR"]) {
    if (env[key]) result[key] = env[key];
  }
  return result;
}
function applicationEnv() {
  const result = {...sanitizedEnv(), PORT: "8080", PUBLIC_URL: origin, NODE_ENV: "production"};
  const keys = [
    "GOOGLE_AI_API_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON", "ASTER_OWNER_UIDS",
    "FIREBASE_PROJECT_ID", "FIREBASE_DATABASE_URL", "FIREBASE_API_KEY",
    "FIREBASE_AUTH_DOMAIN", "FIREBASE_APP_ID", "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_MESSAGING_SENDER_ID", "FIREBASE_MEASUREMENT_ID",
    "ASTER_MODEL_MI_LARGE", "ASTER_MODEL_MI_PLUS", "ASTER_MODEL_MI_AX",
    "ASTER_MODEL_ATMIG", "ASTER_MODEL_ATMIG_PLUS",
  ];
  for (const key of keys) if (env[key]) result[key] = env[key];
  return result;
}
async function endProcess(child, graceMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const until = Date.now() + graceMs;
  while (child.exitCode === null && child.signalCode === null && Date.now() < until) {
    await sleep(400);
  }
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
async function statusForSelf(status, description) {
  if (!deploymentId) return;
  await github("/deployments/" + deploymentId + "/statuses", "POST", {
    state: status,
    description,
    auto_inactive: false,
    log_url: "https://github.com/" + repo + "/actions/runs/" + runId,
  });
}
async function announceReady() {
  const environment = deploymentEnvironment(state.chain, state.generation);
  const deployment = await github("/deployments", "POST", {
    ref: env.GITHUB_SHA,
    environment,
    description: "AsTeR temporary host generation " + state.generation,
    auto_merge: false,
    required_contexts: [],
    transient_environment: true,
    production_environment: false,
    payload: {run_id: runId, parent_run_id: state.parent, chain: state.chain},
  });
  deploymentId = deployment.id;
  await statusForSelf("success", "Runner ready; local application and tunnel healthy.");
}
async function isSuccessorReady(afterMs) {
  const environment = encodeURIComponent(deploymentEnvironment(state.chain, state.generation + 1));
  const deployments = await github("/deployments?environment=" + environment + "&per_page=10");
  for (const item of deployments) {
    const payload = item.payload || {};
    if (String(payload.parent_run_id || "") !== runId) continue;
    if (Date.parse(item.created_at || "") < afterMs - 120_000) continue;
    const statuses = await github("/deployments/" + item.id + "/statuses?per_page=1");
    if (!statuses.length || statuses[0].state !== "success") continue;
    if (Date.now() - Date.parse(statuses[0].created_at || "") > 150_000) continue;
    const childRunId = String(payload.run_id || "");
    if (!/^[1-9][0-9]{0,19}$/.test(childRunId)) continue;
    const run = await github("/actions/runs/" + childRunId);
    if (run.status === "in_progress" && !run.conclusion) return true;
  }
  return false;
}
async function verifyNoDuplicateGenesis() {
  if (state.generation !== 1) return;
  const results = await github("/actions/workflows/host.yml/runs?per_page=100");
  const otherActive = (results.workflow_runs || []).some((r) =>
    String(r.id) !== runId && isActive(r)
  );
  if (otherActive) throw new Error("A host runner is already active; refusing duplicate initial session.");
}

async function main() {
  console.log("AsTeR host generation " + state.generation + " | chain " + state.chain);
  startupStage = "check existing runners";
  await verifyNoDuplicateGenesis();
  startupStage = "start application";
  app = spawn(process.execPath, ["--import", "tsx", "server/standalone.ts"], {
    cwd: "app",
    env: applicationEnv(),
    stdio: ["ignore", "ignore", "pipe"],
  });
  attachSafeDiagnostics(app);
  app.on("error", () => { stopping = true; });
  await waitUntilHealthy("http://127.0.0.1:8080/api/health", app, 120_000, "Node server");
  console.log("Application ready.");
  startupStage = "start Cloudflare tunnel";

  tunnel = spawn(env.CLOUDFLARED_BIN || "/usr/local/bin/cloudflared",
    ["tunnel", "--no-autoupdate", "--metrics", "127.0.0.1:2000",
      "--grace-period", "120s", "run"], {
      env: {...sanitizedEnv(), TUNNEL_TOKEN: env.CLOUDFLARE_TUNNEL_TOKEN},
      stdio: "ignore",
    });
  tunnel.on("error", () => { stopping = true; });
  await waitUntilHealthy("http://127.0.0.1:2000/ready", tunnel, 180_000, "Cloudflare tunnel");
  startupStage = "check public HTTPS health";
  if (!(await healthy(origin + "/api/health"))) {
    throw new Error("Public HTTPS health endpoint is not responding.");
  }
  startupStage = "publish runner readiness";
  await announceReady();
  startupStage = "serve and rotate";
  console.log("Public host healthy: " + origin);

  let lastHeartbeat = Date.now();
  let lastLocalCheck = Date.now();
  let dispatched = false;
  let dispatchedAt = 0;
  let successorReadyChecks = 0;
  while (!stopping && !shouldDrain(elapsedMinutes())) {
    if (app.exitCode !== null || tunnel.exitCode !== null) throw new Error("A server child process exited.");
    if (Date.now() - lastLocalCheck >= 30_000) {
      if (!(await healthy("http://127.0.0.1:8080/api/health")) ||
          !(await healthy("http://127.0.0.1:2000/ready"))) {
        throw new Error("The local server or tunnel became unhealthy.");
      }
      lastLocalCheck = Date.now();
    }
    if (Date.now() - lastHeartbeat >= 60_000) {
      try {
        await statusForSelf("success", "Runner heartbeat; web server and tunnel active.");
        lastHeartbeat = Date.now();
      } catch {
        console.error("Heartbeat status update failed; retrying.");
      }
    }
    if (shouldDispatch(elapsedMinutes(), dispatched)) {
      dispatched = true;
      dispatchedAt = Date.now();
      try {
        await github("/actions/workflows/host.yml/dispatches", "POST", {
          ref: "main",
          inputs: {
            chain: state.chain,
            generation: String(state.generation + 1),
            parent: runId,
          },
        });
        console.log("Requested successor generation " + (state.generation + 1));
      } catch {
        console.error("Successor dispatch failed; keeping the current instance until deadline.");
      }
    }
    if (dispatched && dispatchedAt && Date.now() - dispatchedAt >= 25_000) {
      try {
        if (await isSuccessorReady(dispatchedAt)) {
          successorReadyChecks++;
          if (successorReadyChecks >= 2) {
            console.log("Successor ready and live: retiring predecessor.");
            break;
          }
        } else {
          successorReadyChecks = 0;
        }
      } catch {
        successorReadyChecks = 0;
        console.error("Successor readiness check unavailable; retaining predecessor.");
      }
    }
    await sleep(15_000);
  }
}

try {
  await main();
} catch (error) {
  // Never print environment values, API response bodies, or the credentials.
  console.error("AsTeR host stopped during stage: " + startupStage + ". Credential values are not logged.");
  process.exitCode = 1;
} finally {
  console.log("Draining tunnel and stopping the app.");
  await endProcess(tunnel, 125_000);
  await endProcess(app, 35_000);
  try { await statusForSelf("inactive", "Runner stopped."); } catch {}
}
