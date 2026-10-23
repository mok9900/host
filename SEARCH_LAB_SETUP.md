# AsTeR Search Lab — one-click native search integration

## What happens automatically

The search service runs as a **separate manually started GitHub-hosted Actions
test session**. It is not mixed into the main `xoxgroup.store` server process.

1. `AsTeR Search Lab → Run workflow → operation: start`.
2. GitHub Actions checks out the private search-engine code and starts
   SearXNG plus the authenticated AsTeR gateway in Docker.
3. The workflow derives a scoped server-to-server bearer key from the
   **existing** `PRIVATE_REPO_TOKEN` secret; no additional repository
   Secrets or manual token copy are necessary.
4. Cloudflare Quick Tunnel assigns a temporary HTTPS
   `https://<random>.trycloudflare.com` endpoint.
5. After remote `GET /healthz` succeeds, the runner writes a **signed,
   expiring, public URL-only registry record** to
   `runtime/search-registry.json`.
6. The main AsTeR API reads the registry when a search is requested, checks
   the signature, expiry and HTTPS hostname, and connects automatically using
   its independently derived bearer token.
7. The AI receives ranked sources with the user's chosen
   `auto / on / off` search preference, and shows actual URLs with its
   grounded answer.

### No second credential setup

The repository must still retain the **existing**
`PRIVATE_REPO_TOKEN` (already needed to check out `mok9900/aster-ai`).
Neither `CLOUDFLARE_SEARCH_TUNNEL_TOKEN` nor a separately configured
`ASTER_TOOL_TOKEN` is required.

Never expose the existing private repository token. Its HMAC-derived search
key remains private to the two trusted GitHub-hosted runners; it is not
committed into the registry or browser assets.

## Start

1. Open **GitHub → mok9900/host → Actions → AsTeR Search Lab**.
2. Select **Run workflow**, branch `main`, operation **start**.
3. Wait until the `serve` job says `AsTeR Search Lab online`.
4. Use the ordinary **xoxgroup.store** AI chat; the main backend discovers
   the tunnel automatically (registry cached for at most ~15 seconds).
5. Set web search to **켜기**, or leave it at **자동** for fresh-information
   questions. Other queries do not use the search machine.

**Important:** The main AsTeR runner must be running a generation that
includes `feat/aster-native-search-20261023` and the updated
`scripts/relay.mjs`; if an older host generation is already running, its
next host deployment/handover must pick up this update first.

## Stop

- Same workflow → **Run workflow → operation: stop**.
- Or **Cancel workflow** on the running `serve` job.

Stop removes the currently signed search endpoint registry (where possible)
and requests cancellation. A cancelled or expired tunnel is never treated as
a verified source. General AI chat stays online.

## Limits

- There is **no preselected calendar date** on which the experiment ends.
- Each GitHub-hosted test job still has a hard execution limit of six hours;
  this workflow uses 350 minutes. There is **no automatic job-chain renewal**.
  Start the next test session manually if desired.
- Cloudflare Quick Tunnel is intended for **testing** and uses a new random
  hostname each run; it should not be treated as a production SLA.
- GitHub Actions is primarily CI/CD infrastructure, not guaranteed 24/7
  application hosting. Use dedicated compute for persistent services.
- Search results come from self-hosted SearXNG metasearch and may be limited by
  the source engines. Do not treat snippets as fully verified full-page reads.

## Technical reference

- Search API source: `mok9900/aster-ai/search-engine/`
- Signed registration: `scripts/search-lab-registry.mjs`
- Derived token provisioning: `scripts/search-lab-identity.mjs`
- Application service discovery: `server/native-search.ts`
- GitHub Actions workflow: `.github/workflows/aster-search-lab.yml`
- Live signed record: `runtime/search-registry.json` (contains **no secret**)
- Test: `node --test tests/search-lab-registry.test.mjs`

Formerly created `aster-search-lab` named Cloudflare Tunnel and
`search-dev.xoxgroup.store` DNS entry are **not used** by this one-click
mode. The Quick Tunnel URL is discovered through the signed registry.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `검색 테스트 머신이 꺼져 있습니다` | Action `serve` started and registry is `online`. |
| `401` search request | Existing `PRIVATE_REPO_TOKEN` changed between the main and search sessions; restart both with the same secret. |
| Main site shows old search mode | Main host generation still uses older source; wait for the next main host deployment. |
| Search gateway `502` | Inspect SearXNG startup/upstream engine logs; health check alone does not guarantee real search results. |
| Cloudflare endpoint unavailable | Quick Tunnel connection/limits; inspect the `serve` job logs. |
| Search runner expires | Manually start a new session. The main server will discover the new URL without manual configuration. |
