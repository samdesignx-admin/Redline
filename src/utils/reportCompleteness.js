/**
 * Validate that independently generated AI report batches actually contain
 * each requested section and meaningful text. Partial successes must not be
 * presented as complete (or charged as complete audits).
 */
import { normalizeReportText } from "./reportParser.js";

function expectedBatchSections(template) {
  return String(template || "")
    .split(/(?=^#\s+)/gm)
    .map((section) => ({
      heading: /^#\s+(.+)\s*$/m.exec(section)?.[1]?.trim() || "",
      spec: section.trim(),
    }))
    .filter((section) => section.heading);
}

function generatedReportSections(response) {
  const normalized = normalizeReportText(String(response || ""));
  const headings = [...normalized.matchAll(/^#\s+(.+?)\s*$/gm)];
  return new Map(headings.map((match, index) => {
    const start = match.index + match[0].length;
    const end = headings[index + 1]?.index ?? normalized.length;
    return [match[1].trim().toLowerCase(), normalized.slice(start, end).trim()];
  }));
}

function missingBatchSections(template, response) {
  const sections = generatedReportSections(response);
  return expectedBatchSections(template).filter(({ heading }) => {
    const actual = sections.get(heading.toLowerCase());
    // A header with no substantive assessment is a placeholder, not a report.
    return !actual || actual.length < 28;
  });
}

export { expectedBatchSections, generatedReportSections, missingBatchSections };
