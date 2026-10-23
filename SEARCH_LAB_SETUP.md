# AsTeR Search Lab — isolated test runner

**Mode:** opt-in, manually started development test environment.
**Application:** `mok9900/aster-ai@feat/aster-native-search-20261023`.
**Public test endpoint:** `https://search-dev.xoxgroup.store` (separate Cloudflare Tunnel).
**Production website:** `https://xoxgroup.store` (independent tunnel, untouched).

## One-time setup (GitHub Secrets)

The tunnel `aster-search-lab` and `search-dev.xoxgroup.store` DNS entry
already exist in the connected Cloudflare account. Do **not** reuse the
`hostaster` tunnel token from the main website.

In Cloudflare Zero Trust → Networks → Connectors → Cloudflare Tunnels,
open `aster-search-lab` and its install/connect instructions. Copy the
token shown after `cloudflared tunnel run --token`.

In the **public orchestration repository** `mok9900/host` → Settings →
Secrets and variables → Actions → New repository secret, add:

- `CLOUDFLARE_SEARCH_TUNNEL_TOKEN`: token from **aster-search-lab** tunnel
- `ASTER_TOOL_TOKEN`: an independent random secret of at least 32 chars
  (example generation: `openssl rand -hex 32`)

Store both in GitHub Actions Secrets only. Never commit or paste them into
public workflow files, logs, chat, or URLs.

The host workflow already forwards `ASTER_TOOL_TOKEN` to the AsTeR server,
and uses `https://search-dev.xoxgroup.store` as its default search URL.
Once the new runner has connected and the main host has loaded the new
secret, the native search engine is selected automatically over Google
Search Grounding.

## Start a development session

1. Open Actions → **AsTeR Search Lab**.
2. Click **Run workflow** on `main`.
3. Choose **operation: start**.
4. Wait for `validate` then `serve` to finish booting.
5. Inspect `serve` job logs, confirm that Cloudflare connector is online.
6. Test GET `https://search-dev.xoxgroup.store/healthz` for
   `{"ok":true,...}` before using AsTeR search.
7. On the main site, set search mode to **켜기** and ask for a recent
   technical announcement; verify citations and time.

Search requests to `POST /v1/search` require
`Authorization: Bearer <ASTER_TOOL_TOKEN>`. The browser does not receive
this token, only the authenticated AsTeR backend can use it.

## Stop a session

1. Actions → **AsTeR Search Lab** → **Run workflow**.
2. Choose **operation: stop**.
3. That run requests cancellation of active search test jobs.

Alternatively open the active `serve` workflow run and choose
**Cancel workflow**.

The search lab has **no calendar-based automatic shutoff**, but each
GitHub-hosted job has a **hard six-hour cap** (set to 350 minutes here).
**It does not auto-renew or promise 24/7 operation.** To run another test
session, start it manually again. The search feature gracefully falls
back to general model knowledge if the test tunnel is offline.

For a true continuously running search server without Actions limits,
deploy `aster-ai/search-engine/docker-compose.yml` on a supported
container host or use a self-hosted runner for development testing.

## Diagnostics

- CI check: Actions → **AsTeR Search Lab**, push-triggered validation.
- Server healthy but no search results: inspect `search`/SearXNG logs,
  search upstream throttling and JSON `formats` configuration.
- API 401: `ASTER_TOOL_TOKEN` mismatch between test gateway and main host.
- API 502/503: check the tunnel connector, containers, and upstream engines.
- No search feature in AsTeR: the main host must use the
  `feat/aster-native-search-20261023` source and have the new secret.
- Search mode `on` fails if the test session is offline, by design.

**Security:** GitHub Actions virtual machines are ephemeral. Do not store
persistent user data there. The search server has no Firebase admin
credentials or Gemini API keys.
