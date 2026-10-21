export const JOB_MAX_MINUTES = 355;
export const DISPATCH_AT_MINUTES = 315;
export const DRAIN_AT_MINUTES = 350;
export const ACTIVE_STATUSES = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

export function parsePositiveInt(input, name) {
  const value = String(input ?? "");
  if (!/^[1-9][0-9]{0,9}$/.test(value)) throw new Error(name + " must be a positive integer.");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(name + " is out of range.");
  return number;
}

export function isValidId(input) {
  return /^[1-9][0-9]{0,19}$/.test(String(input || ""));
}

export function normalizeOrigin(value) {
  const raw = String(value || "");
  let url;
  try { url = new URL(raw); } catch { throw new Error("ASTER_PUBLIC_URL must be a valid HTTPS origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("ASTER_PUBLIC_URL must contain only an HTTPS origin.");
  }
  return url.origin;
}

export function deploymentEnvironment(chain, generation) {
  if (!isValidId(chain)) throw new Error("Invalid chain ID.");
  const gen = parsePositiveInt(generation, "generation");
  return "aster-host-" + chain + "-gen-" + gen;
}

export function isActive(run) {
  return !!run && ACTIVE_STATUSES.has(run.status);
}

export function shouldDispatch(elapsedMinutes, alreadyDispatched) {
  return !alreadyDispatched && elapsedMinutes >= DISPATCH_AT_MINUTES && elapsedMinutes < DRAIN_AT_MINUTES;
}

export function shouldDrain(elapsedMinutes) {
  return elapsedMinutes >= DRAIN_AT_MINUTES;
}

export function validateGeneration(chain, generation, parent, currentRunId) {
  const gen = parsePositiveInt(generation, "generation");
  if (!isValidId(currentRunId)) throw new Error("Invalid current run ID.");
  if (gen === 1) {
    if (parent) throw new Error("Initial generation cannot have a parent.");
    if (chain && chain !== currentRunId) throw new Error("Initial chain must be its own run ID.");
    return {chain: currentRunId, generation: 1, parent: ""};
  }
  if (!isValidId(chain) || !isValidId(parent) || parent === currentRunId) {
    throw new Error("Continuation must specify valid chain and parent run IDs.");
  }
  return {chain, generation: gen, parent};
}
