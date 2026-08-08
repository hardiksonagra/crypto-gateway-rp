/**
 * Shared SUCCESS-TEST / FAIL-TEST conventions for gateway payout simulation
 * (same behaviour + response shape in sandbox and live when these refs are used).
 */

/**
 * @param {string | null | undefined} clientReferenceId
 */
export function normalizePayoutClientRef(clientReferenceId) {
  return String(clientReferenceId ?? "")
    .trim()
    .toUpperCase();
}

/**
 * @param {string | null | undefined} clientReferenceId
 */
export function isPayoutFailTestRef(clientReferenceId) {
  const ref = normalizePayoutClientRef(clientReferenceId);
  return (
    ref.startsWith("FAIL-TEST") ||
    ref.startsWith("FAIL_") ||
    ref.startsWith("FAIL-") ||
    ref === "FAIL" ||
    ref.startsWith("SANDBOX_FAIL")
  );
}

/**
 * @param {string | null | undefined} clientReferenceId
 */
export function isPayoutSuccessTestRef(clientReferenceId) {
  const ref = normalizePayoutClientRef(clientReferenceId);
  return (
    ref.startsWith("SUCCESS-TEST") ||
    ref.startsWith("SUCCESS_") ||
    ref.startsWith("SUCCESS-") ||
    ref === "SUCCESS"
  );
}

/**
 * Explicit integrator test refs (skip ledger + skip chain on live too).
 *
 * @param {string | null | undefined} clientReferenceId
 */
export function isPayoutSimulatedTestRef(clientReferenceId) {
  return (
    isPayoutFailTestRef(clientReferenceId) || isPayoutSuccessTestRef(clientReferenceId)
  );
}

/**
 * @param {unknown} forceFail
 */
export function isPayoutForceFailFlag(forceFail) {
  if (forceFail === true || forceFail === 1 || forceFail === "1") return true;
  if (typeof forceFail === "string" && forceFail.trim().toLowerCase() === "true")
    return true;
  return false;
}

/**
 * Body `simulate_result` / `simulateResult` (sandbox preferred path — avoids reusing client_reference_id).
 * @param {unknown} raw
 * @returns {"failed" | "completed" | null}
 */
export function parseSimulateResult(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "failed" || s === "fail" || s === "failure") return "failed";
  if (s === "success" || s === "succeeded" || s === "completed" || s === "ok") {
    return "completed";
  }
  return null;
}

/**
 * @param {unknown} forceFail
 * @param {string | null | undefined} clientReferenceId
 * @param {unknown} [simulateResult]
 * @returns {"failed" | "completed"}
 */
export function simulatedPayoutOutcome(forceFail, clientReferenceId, simulateResult) {
  const fromBody = parseSimulateResult(simulateResult);
  if (fromBody) return fromBody;
  if (isPayoutForceFailFlag(forceFail) || isPayoutFailTestRef(clientReferenceId)) {
    return "failed";
  }
  return "completed";
}

/**
 * Sandbox: make client_reference_id unique under DB constraint while keeping FAIL-TEST / SUCCESS-TEST prefix.
 *
 * @param {string} baseRef
 * @returns {string}
 */
export function uniquifySandboxClientRef(baseRef) {
  const suffix = `-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const base = String(baseRef ?? "").trim().slice(0, Math.max(1, 256 - suffix.length));
  return `${base}${suffix}`.slice(0, 256);
}
