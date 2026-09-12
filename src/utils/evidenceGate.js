/**
 * Evidence gating policy.
 *
 * A screenshot is not automatically proof of the underlying website UI. The
 * retrieval layer may have captured an access-control/interstitial page. This
 * module gives the audit pipeline one deterministic decision point before it
 * asks vision to place precise finding markers.
 */

const ACCESS_CONTROL_PATTERNS = [
  /access denied/i,
  /forbidden/i,
  /you don't have permission/i,
  /request blocked/i,
  /security check/i,
  /bot detection/i,
  /unusual traffic/i,
  /akamai/i,
  /edgesuite\.net/i,
  /reference\s*#?\d+/i,
  /error reference number/i,
];

const VISUAL_EVIDENCE_STATES = Object.freeze([
  "usable-page",
  "access-control",
  "blank",
  "unknown",
]);

function looksLikeAccessControl(value) {
  const text = String(value || "").trim();
  return !!text && ACCESS_CONTROL_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeVisualEvidenceState(value) {
  const state = String(value || "").trim().toLowerCase();
  return VISUAL_EVIDENCE_STATES.includes(state) ? state : "unknown";
}

function gateVisualEvidence({
  screenshot,
  screenshotState,
  retrievalStatus,
  diagnostics,
  screenshotDescription,
} = {}) {
  if (!screenshot || typeof screenshot !== "string" || !screenshot.startsWith("data:image/")) {
    return { allowed: false, state: "blank", status: "insufficient", reason: "No usable screenshot was captured." };
  }

  const explicitState = normalizeVisualEvidenceState(screenshotState);
  if (explicitState === "access-control") {
    return { allowed: false, state: explicitState, status: "blocked", reason: "The captured screenshot is an access-control/interstitial state." };
  }
  if (explicitState === "blank") {
    return { allowed: false, state: explicitState, status: "insufficient", reason: "The captured screenshot does not contain a usable page state." };
  }

  const combined = [retrievalStatus, diagnostics, screenshotDescription].filter(Boolean).join(" ");
  if (looksLikeAccessControl(combined)) {
    return { allowed: false, state: "access-control", status: "blocked", reason: "The available retrieval evidence indicates an access-control state." };
  }

  return {
    allowed: true,
    state: explicitState === "usable-page" ? explicitState : "unknown",
    status: explicitState === "usable-page" ? "observed" : "unverified",
    reason: explicitState === "usable-page"
      ? "The screenshot has been explicitly classified as a usable page state."
      : "The screenshot is available, but its page state has not been explicitly classified.",
  };
}

function shouldGeneratePreciseEvidence(result) {
  return !!result?.allowed && result.status === "observed";
}

export {
  ACCESS_CONTROL_PATTERNS,
  VISUAL_EVIDENCE_STATES,
  looksLikeAccessControl,
  normalizeVisualEvidenceState,
  gateVisualEvidence,
  shouldGeneratePreciseEvidence,
};
