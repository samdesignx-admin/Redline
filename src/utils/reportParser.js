import { severityFor } from "../config/severity.js";
import { SITE_URL } from "../config/index.js";

function stripDashLines(s) {
  return (s || "")
    .split("\n")
    .filter((l) => !/^-{4,}\s*$/.test(l.trim()))
    .join("\n")
    .trim();
}

function parseIssues(block) {
  const content = stripDashLines(block);
  const re =
    /Issue:\s*([\s\S]+?)\nSeverity:\s*([\s\S]+?)\nWhy it matters:\s*([\s\S]+?)\nRecommendation:\s*([\s\S]+?)(?=\n+Issue:|\s*$)/g;
  const issues = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    issues.push({
      title: m[1].trim().replace(/^\*+|\*+$/g, ""),
      severity: severityFor(m[2]),
      why: m[3].trim(),
      recommendation: m[4].trim(),
    });
  }
  const introEnd = content.search(/Issue:/);
  const intro = introEnd > 0 ? content.slice(0, introEnd).trim() : "";
  return { intro, issues };
}

function parseNumberedList(text) {
  if (!text) return [];
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+[\.\)]\s*/.test(l))
    .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
    .filter(Boolean);
}

function parseDashList(text) {
  if (!text) return [];
  return stripDashLines(text)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s*/.test(l))
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

function parseSummary(block) {
  const content = stripDashLines(block);
  const scoreM = content.match(/Overall UX Score:\s*(\d+)/i);
  const assessM = content.match(
    /Overall Assessment:\s*[\*_]*\s*(Excellent|Good|Average|Poor)/i
  );
  const strengthsStart = content.search(/Top Strengths:/i);
  const concernsStart = content.search(/Top Concerns:/i);
  let strengthsText = "";
  let concernsText = "";
  if (strengthsStart >= 0) {
    strengthsText = content.slice(strengthsStart, concernsStart >= 0 ? concernsStart : content.length);
  }
  if (concernsStart >= 0) concernsText = content.slice(concernsStart);
  const introEnd = strengthsStart >= 0 ? strengthsStart : content.length;
  return {
    intro: content.slice(0, introEnd).replace(/Overall UX Score:.*$/im, "").replace(/Overall Assessment:.*$/im, "").trim(),
    score: scoreM ? Number(scoreM[1]) : null,
    assessment: assessM ? assessM[1] : null,
    strengths: parseNumberedList(strengthsText),
    concerns: parseNumberedList(concernsText),
  };
}

function parseTop10(block) {
  const content = stripDashLines(block);
  const re =
    /(\d+)[\.\)]\s*(?:\*+)?Recommendation:?(?:\*+)?\s*([\s\S]+?)\n+(?:\*+)?Expected User Benefit:?(?:\*+)?\s*([\s\S]+?)\n+(?:\*+)?Expected Business Benefit:?(?:\*+)?\s*([\s\S]+?)(?=\n+\d+[\.\)]|\s*$)/g;
  const items = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    items.push({
      rank: Number(m[1]),
      recommendation: m[2].trim(),
      userBenefit: m[3].trim(),
      businessBenefit: m[4].trim(),
    });
  }
  return items;
}

function parseScorecard(block) {
  const content = stripDashLines(block);
  const num = (label) => {
    const m = content.match(new RegExp(label + ":?\\s*\\*{0,2}\\s*(\\d+)", "i"));
    return m ? Number(m[1]) : null;
  };
  const verdictM = content.match(/Final Verdict:\s*([\s\S]+)$/i);
  return {
    usability: num("Usability"),
    accessibility: num("Accessibility"),
    visual: num("Visual Design"),
    trust: num("Trust"),
    conversion: num("Conversion"),
    overall: num("Overall UX Score"),
    verdict: verdictM ? verdictM[1].trim() : "",
  };
}

function normalizeReportText(rawText) {
  let t = (rawText || "").replace(/\r\n/g, "\n").replace(/```[a-z]*\n?/gi, "");
  // Normalize any heading depth (#, ##, ###) to a single '# '
  t = t.replace(/^#{1,6}\s+/gm, "# ");
  // Convert bold-only section title lines (e.g. **Executive Summary**) into headers
  const sectionAlt = KNOWN_SECTIONS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  t = t.replace(new RegExp(`^\\s*\\*{1,2}(${sectionAlt})\\*{1,2}\\s*$`, "gmi"), "# $1");
  // Also catch plain title lines that exactly match a known section name
  t = t.replace(new RegExp(`^(${sectionAlt})\\s*$`, "gmi"), (m, name) => `# ${name}`);
  // Strip bold markers around field labels so the issue regex matches
  t = t.replace(/\*\*(Issue|Severity|Why it matters|Recommendation|Expected User Benefit|Expected Business Benefit|Overall UX Score|Overall Assessment|Top Strengths|Top Concerns|Final Verdict|Usability|Accessibility|Visual Design|Trust|Conversion):\*\*/gi, "$1:");
  t = t.replace(/\*\*(Issue|Severity|Why it matters|Recommendation|Expected User Benefit|Expected Business Benefit|Final Verdict):\s*/gi, "$1: ");
  return t;
}

function parseReport(rawText) {
  const clean = normalizeReportText(rawText);
  const headerRe = /^#\s+(.+?)\s*$/gm;
  const matches = [...clean.matchAll(headerRe)];
  const sections = {};
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : clean.length;
    sections[title] = clean.slice(start, end).trim();
  }
  const find = (key) =>
    sections[Object.keys(sections).find((k) => k.toLowerCase().includes(key))] || "";

  return {
    raw: clean,
    hasContent: matches.length > 0,
    summary: parseSummary(find("executive summary")),
    usability: parseIssues(find("usability analysis")),
    visual: parseIssues(find("visual design analysis")),
    accessibility: parseIssues(find("accessibility review")),
    trust: parseIssues(find("trust")),
    conversion: parseIssues(find("conversion optimization")),
    cognitive: parseIssues(find("cognitive load")),
    aiRecommendations: stripDashLines(find("ai recommendations")),
    top10: parseTop10(find("top 10")),
    quickWins: parseDashList(find("quick wins")),
    strategic: parseDashList(find("strategic improvements")),
    scorecard: parseScorecard(find("final scorecard")),
  };
}

function buildPlainTextSummary(report, source, saved) {
  if (!report) return "";
  // Keep well under ~1800 chars: long mailto: URLs are silently dropped by
  // many mail clients and browsers.
  const lines = [];
  const src = source && source.mode === "url" && source.url ? source.url : "uploaded screens";
  lines.push(`Nest Audit — ${src}`);
  lines.push(`Overall score: ${report.summary.score ?? "—"}/100 (${report.summary.assessment ?? "Unrated"})`);
  if (report.summary.concerns.length) {
    lines.push("", "Top concerns:");
    report.summary.concerns.slice(0, 3).forEach((c, i) => lines.push(`${i + 1}. ${String(c).slice(0, 120)}`));
  }
  if (report.scorecard.verdict) {
    lines.push("", "Verdict: " + String(report.scorecard.verdict).slice(0, 300));
  }
  lines.push("", "View the full report, slide deck and PDF export:");
  lines.push(saved ? `${SITE_URL}/#myaudits` : SITE_URL);
  if (!saved) {
    lines.push("(Log in and re-run to keep audits in your history.)");
  }
  return lines.join("\n").slice(0, 1500);
}


export {
  stripDashLines, parseIssues, parseNumberedList, parseDashList, parseSummary,
  parseTop10, parseScorecard, normalizeReportText, parseReport, buildPlainTextSummary,
};
