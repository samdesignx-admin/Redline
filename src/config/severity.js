import { C } from "./theme.js";
import { AlertCircle, AlertTriangle, Info, CircleDot } from "lucide-react";

const SEVERITY_STYLES = {
  Critical: { color: C.critical, bg: C.criticalSoft, icon: AlertCircle, label: "Critical" },
  High: { color: C.high, bg: C.highSoft, icon: AlertTriangle, label: "High" },
  Medium: { color: C.medium, bg: C.mediumSoft, icon: Info, label: "Medium" },
  Low: { color: C.low, bg: C.lowSoft, icon: CircleDot, label: "Low" },
};

function severityFor(raw) {
  const s = (raw || "").toLowerCase();
  if (s.includes("critical")) return "Critical";
  if (s.includes("high")) return "High";
  if (s.includes("medium")) return "Medium";
  if (s.includes("low")) return "Low";
  return "Medium";
}

export { SEVERITY_STYLES, severityFor };
