# AsTeR AI — GitHub Actions host

Control plane for `mok9900/aster-ai` using GitHub Actions, overlapping runners and Cloudflare Tunnel replicas. The application source stays **private**; only orchestration scripts and workflow definitions are stored in this public repository.

## Architecture

1. An Actions runner checks out the private application into a temporary workspace.
2. The runner builds the app and starts the existing standalone Node.js frontend + API server on `127.0.0.1:8080`.
3. `cloudflared` connects the server to a **fixed, remotely managed Cloudflare Tunnel**.
4. About **40 minutes before the runner's 355-minute job deadline**, the runner dispatches its successor.
5. The predecessor waits for a successor readiness deployment and a recent heartbeat before stopping its tunnel.
6. A watchdog workflow checks every 10 minutes and requests a fresh runner if none is queued or running.

Each run is bounded to 355 minutes; overlapping runs are allowed. GitHub workflow scheduling, queue delays and tunnel routing can cause downtime. This is not an uptime guarantee.

## Required GitHub configuration

On **this repository** go to `Settings → Secrets and variables → Actions`.

**Secrets**

| Name | Purpose |
| ---- | ------- |
| `PRIVATE_REPO_TOKEN` | Fine-grained GitHub PAT with **Contents: Read** only on `mok9900/aster-ai`. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Connector token for a remotely managed Cloudflare Tunnel. |
| `GOOGLE_AI_API_KEY` | AI backend secret; optional for first startup, required for live chat. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin service account; optional for UI-only startup, required for authenticated APIs. |
| `ASTER_OWNER_UIDS` | Optional comma-separated owner UIDs. |
| `ASTER_MODEL_MI_LARGE`, `ASTER_MODEL_MI_PLUS`, `ASTER_MODEL_MI_AX`, `ASTER_MODEL_ATMIG`, `ASTER_MODEL_ATMIG_PLUS` | Optional provider model overrides. |

**Variables**

| Name | Purpose |
| ---- | ------- |
| `ASTER_PUBLIC_URL` | Full **HTTPS origin**, e.g. `https://chat.example.com`, no trailing path. |
| `HOST_ENABLED` | Set to `true` only **after** token/tunnel setup and when ready to start. Defaults to disabled. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID` | Optional Firebase overrides. The existing app already supplies its public Firebase defaults. |

Create a Cloudflare published application route for `ASTER_PUBLIC_URL` pointing to **`http://127.0.0.1:8080`** on the tunnel connector. Enable the new hostname in Firebase Authentication authorized domains.

The app checkout currently uses the existing private source branch `feat/bounded-actions-relay-20261021`, which contains `server/standalone.ts` and `npm run serve`. This can be switched to `main` once that standalone server is merged. No private code or application build artifacts are committed to this repository.

## Start

1. Set the required connection secrets and public URL above.
2. Set `HOST_ENABLED=true`.
3. Open **Actions → AsTeR host runner → Run workflow → main**, leaving the generation inputs at their defaults.
4. Open the configured HTTPS domain and `/api/health`. A successful health response is `{"ok":true,"service":"AsTeR Ai"}`.
5. The **AsTeR host watchdog** workflow can be triggered manually or runs every 10 minutes while enabled. It does not need to be started separately for continuous checking.

## Stop

Open **Actions → Stop AsTeR hosting → Run workflow**. This disables the runner workflow then cancels active/queued runner executions. To resume, re-enable **AsTeR host runner** **and** **AsTeR host watchdog** on the Actions page, then set `HOST_ENABLED=true`. For a durable stop, also set `HOST_ENABLED=false` in repository variables.

## Operational details

- Target job timeout: **355 minutes**; handover request at **315 minutes** from the start of the job (40-minute overlap budget).
- Readiness: local frontend + API health, tunnel readiness, then successful deployment heartbeat. The predecessor also confirms the successor's Actions run is still active.
- A manual/automated new **generation 1** boot is blocked when other host runs are already active.
- Watchdog launches only if **no** active `AsTeR host runner` job is queued/running. It uses a concurrency group to avoid simultaneous watchdog launches.
- Runtime data persists in Firebase, not on ephemeral runners. Auth sessions, uploaded files, in-flight streaming responses and local memory are not handed off automatically.
- GitHub Secrets are never placed in source files or uploaded as artifacts. The GitHub and Cloudflare credentials are stripped from the application child process environment.
- Watchdog schedule delivery can be delayed and GitHub Actions may queue or reject new jobs. A successful dispatch alone is *not* a ready server.
- Do not copy your `.env` or Firebase Admin JSON into this public repository.

## Verification

The repo has a no-secret validation workflow and tests for the handover logic:

```bash
node --test tests/*.test.mjs
node --check scripts/relay.mjs
node --check scripts/watchdog.mjs
```

Once connection secrets are configured, a real Actions run and an HTTPS end-to-end test are required before treating the site as available.
