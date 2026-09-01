import { CircleDot } from "lucide-react";
import { C, SEVERITY_STYLES } from "../config/index.js";

/* ----------------------------------------------------------------------- */
/* Small UI atoms                                                           */
/* ----------------------------------------------------------------------- */
function Squiggle({ width = 64, color = C.gold }) {
  return (
    <svg width={width} height="8" viewBox="0 0 64 8" fill="none" style={{ display: "block" }}>
      <path
        d="M1 5.5C4 2 7 1 10 4C13 7 16 2 19 2C22 2 25 6.5 28 6.5C31 6.5 34 1.5 37 1.5C40 1.5 43 6 46 6C49 6 52 1.5 55 2C58 2.5 60 5 63 4.5"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function SeverityBadge({ severity, size = "sm" }) {
  const s = SEVERITY_STYLES[severity] || SEVERITY_STYLES.Medium;
  const Icon = s.icon;
  const pad = size === "sm" ? "3px 9px" : "4px 12px";
  const fs = size === "sm" ? 11 : 12;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, padding: pad, borderRadius: 99,
        background: s.bg, color: s.color, fontFamily: "'IBM Plex Mono', monospace", fontSize: fs,
        letterSpacing: 0.4, fontWeight: 500, border: `1px solid ${s.color}33`, whiteSpace: "nowrap",
      }}
    >
      <Icon size={size === "sm" ? 12 : 13} strokeWidth={2.2} />
      {s.label.toUpperCase()}
    </span>
  );
}

function IssueCard({ issue }) {
  const s = SEVERITY_STYLES[issue.severity] || SEVERITY_STYLES.Medium;
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${s.color}`, borderRadius: 10, padding: "16px 18px", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600, fontSize: 16.5, color: C.text, lineHeight: 1.3 }}>{issue.title}</h4>
        <SeverityBadge severity={issue.severity} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: 0.6, color: C.muted, marginBottom: 3 }}>WHY IT MATTERS</div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: C.textDim }}>{issue.why}</p>
      </div>
      <div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, letterSpacing: 0.6, color: C.gold, marginBottom: 3 }}>RECOMMENDATION</div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: C.text }}>{issue.recommendation}</p>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }) {
  const v = value == null ? 0 : value;
  const color = v >= 80 ? C.low : v >= 60 ? C.medium : v >= 40 ? C.high : C.critical;
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 13, color: C.textDim, fontWeight: 500 }}>{label}</span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: C.text }}>{value == null ? "—" : `${value}/100`}</span>
      </div>
      <div style={{ height: 6, background: C.surfaceAlt, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${v}%`, background: color, borderRadius: 99, transition: "width 900ms cubic-bezier(.2,.8,.2,1)" }} />
      </div>
    </div>
  );
}

function SectionIntro({ text }) {
  if (!text) return null;
  return <p style={{ color: C.textDim, fontSize: 14, lineHeight: 1.6, margin: "0 0 14px 0" }}>{text}</p>;
}

function EmptyIssueState() {
  return (
    <p style={{ color: C.muted, fontSize: 13.5, fontStyle: "italic", margin: 0 }}>
      The director found nothing structured to flag here yet — try regenerating, or this area may be clean.
    </p>
  );
}

function Section({ icon: Icon, title, data }) {
  return (
    <div>
      <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: C.text, fontSize: 18, margin: "0 0 14px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={17} color={C.gold} /> {title}
      </h3>
      <SectionIntro text={data.intro} />
      {data.issues.length === 0 ? <EmptyIssueState /> : data.issues.map((issue, i) => <IssueCard key={i} issue={issue} />)}
    </div>
  );
}

function ListBlock({ icon: Icon, title, subtitle, items, color }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: C.text, fontSize: 17, margin: "0 0 2px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <Icon size={16} color={color} /> {title}
      </h3>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>{subtitle}</div>
      {items.length === 0 ? (
        <EmptyIssueState />
      ) : (
        <div>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i < items.length - 1 ? `1px solid ${C.borderSoft}` : "none" }}>
              <CircleDot size={14} color={color} style={{ marginTop: 3, flexShrink: 0 }} />
              <span style={{ fontSize: 13.5, color: C.textDim, lineHeight: 1.55 }}>{it}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Modal({ children, onClose, maxWidth = 420 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(44,32,19,0.55)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, maxWidth, width: "100%", maxHeight: "85vh", overflowY: "auto" }}
      >
        {children}
      </div>
    </div>
  );
}


export {
  Squiggle,
  SeverityBadge,
  IssueCard,
  ScoreBar,
  SectionIntro,
  EmptyIssueState,
  Section,
  ListBlock,
  Modal,
};
