/**
 * Canonical projection shared by visual evidence renderers.
 *
 * The renderer must never derive marker geometry from legacy x/y/w/h after
 * canonicalization. cx/cy are percentages of the ORIGINAL full screenshot;
 * radius is a percentage radius of that same coordinate space.
 */
export const EVIDENCE_RENDER_VERSION = 1;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function projectEvidenceTarget(item = {}) {
  const cx = clamp(Number(item.cx), 0, 100);
  const cy = clamp(Number(item.cy), 0, 100);
  const radius = clamp(Number(item.radius), 1.5, 4.5);
  return {
    findingId: String(item.findingId || "").trim(),
    screenshotId: String(item.screenshotId || "").trim(),
    cx,
    cy,
    radius,
    target: String(item.target || "").trim(),
    explanation: String(item.explanation || "").trim(),
  };
}

/**
 * Returns CSS geometry for a marker that stays proportional to the full
 * screenshot rather than becoming a fixed/giant ellipse at different sizes.
 */
export function markerStyle(item = {}) {
  const target = projectEvidenceTarget(item);
  return {
    left: `${target.cx}%`,
    top: `${target.cy}%`,
    width: `${target.radius * 2}%`,
    aspectRatio: "1 / 1",
    transform: "translate(-50%, -50%)",
    maxWidth: "34px",
    minWidth: "14px",
  };
}

/**
 * For focused/cropped evidence, keep the source target at the exact center.
 * The crop implementation can then choose its viewport independently without
 * changing the target coordinates or marker identity.
 */
export function focusedEvidenceStyle(item = {}) {
  const target = projectEvidenceTarget(item);
  return {
    objectPosition: `${target.cx}% ${target.cy}%`,
    markerLeft: "50%",
    markerTop: "50%",
  };
}
