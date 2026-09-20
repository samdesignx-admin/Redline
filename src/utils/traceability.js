export const TRACEABILITY_VERSION = 1;

function keyOf(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function buildTraceability(findings = []) {
  const groups = new Map();
  const actions = new Map();
  const rootCauses = [];
  const recommendations = [];
  const links = [];
  for (const finding of Array.isArray(findings) ? findings : []) {
    const findingId = String(finding?.id || "").trim();
    if (!findingId) continue;
    const rootText = String(finding?.rootCause || finding?.why || "").trim();
    const actionText = String(finding?.recommendation || "").trim();
    let rootCauseId = null;
    if (rootText) {
      const key = keyOf(rootText);
      if (!groups.has(key)) {
        rootCauseId = `RC-${String(rootCauses.length + 1).padStart(3, "0")}`;
        groups.set(key, rootCauseId);
        rootCauses.push({ id: rootCauseId, text: rootText, findingIds: [] });
      } else rootCauseId = groups.get(key);
      const root = rootCauses.find((item) => item.id === rootCauseId);
      if (root && !root.findingIds.includes(findingId)) root.findingIds.push(findingId);
    }
    let recommendationId = null;
    if (actionText) {
      const key = keyOf(actionText);
      if (!actions.has(key)) {
        recommendationId = `R-${String(recommendations.length + 1).padStart(3, "0")}`;
        actions.set(key, recommendationId);
        recommendations.push({ id: recommendationId, text: actionText, findingIds: [], rootCauseIds: [] });
      } else recommendationId = actions.get(key);
      const action = recommendations.find((item) => item.id === recommendationId);
      if (action && !action.findingIds.includes(findingId)) action.findingIds.push(findingId);
      if (action && rootCauseId && !action.rootCauseIds.includes(rootCauseId)) action.rootCauseIds.push(rootCauseId);
    }
    links.push({ findingId, rootCauseId, recommendationId });
  }
  return { rootCauses, recommendations, links };
}

export { keyOf, buildTraceability };
