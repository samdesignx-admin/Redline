import { useState, useEffect, useMemo } from "react";
import {
  Users, FileText, Gauge, TrendingUp, Globe, ImageIcon, AlertCircle,
  Download, RefreshCw, Lock, BarChart3, Clock, Building2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Data collection                                                     */
/* ------------------------------------------------------------------ */
/* Loads every account and audit from the database via /api/admin, which
   requires the ADMIN_KEY. This is a real view across all users. */
async function loadAll(key) {
  const r = await fetch("/api/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);

  // Normalise database rows into the shape the charts expect.
  const accounts = (data.accounts || []).map((a) => ({
    emailHash: a.id,
    email: a.email,
    name: a.name,
    company: a.company,
    mobile: a.mobile,
    provider: a.provider,
    emailVerified: a.email_verified,
    auditsUsed: a.audits_used,
    createdAt: a.created_at ? new Date(a.created_at).getTime() : null,
    lastLoginAt: a.last_login_at ? new Date(a.last_login_at).getTime() : null,
  }));
  const audits = (data.audits || []).map((x) => ({
    id: x.id,
    email: x.email,
    date: x.created_at ? new Date(x.created_at).getTime() : Date.now(),
    title: x.title,
    mode: x.mode,
    url: x.url,
    screenCount: x.screen_count,
    score: x.score,
    assessment: x.assessment,
    scorecard: x.scorecard,
    severities: x.severities,
  }));
  return { accounts, audits };
}

function parseSection(raw, header) {
  if (!raw) return "";
  const re = new RegExp(`#\\s*${header}([\\s\\S]*?)(?=\\n#\\s|$)`, "i");
  const m = raw.match(re);
  return m ? m[1] : "";
}

function countSeverities(raw) {
  const out = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  if (!raw) return out;
  const matches = raw.matchAll(/Severity:\s*(Critical|High|Medium|Low)/gi);
  for (const m of matches) {
    const k = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    if (out[k] !== undefined) out[k]++;
  }
  return out;
}

function scoreFor(raw, label) {
  if (!raw) return null;
  const m = raw.match(new RegExp(`${label}:\\s*\\*{0,2}\\s*(\\d+)`, "i"));
  return m ? Number(m[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */
function StatCard({ icon: Icon, label, value, sub, C }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, boxShadow: "0 4px 14px rgba(18,48,43,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: C.goldSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={14} color={C.gold} />
        </div>
        <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      </div>
      <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 28, color: C.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function Panel({ title, icon: Icon, children, C, note }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 14, boxShadow: "0 4px 14px rgba(18,48,43,0.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        {Icon && <Icon size={15} color={C.gold} />}
        <h3 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 15, color: C.text, margin: 0 }}>{title}</h3>
      </div>
      {note && <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 12 }}>{note}</div>}
      {!note && <div style={{ marginBottom: 12 }} />}
      {children}
    </div>
  );
}

function BarRow({ label, value, max, C, color, suffix = "" }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: C.textDim, width: 110, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: C.surfaceAlt, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color || C.gold, borderRadius: 99, transition: "width 600ms ease" }} />
      </div>
      <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 12.5, color: C.text, width: 42, textAlign: "right", flexShrink: 0 }}>{value}{suffix}</span>
    </div>
  );
}

function Sparkline({ data, C }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 90 }}>
      {data.map((d) => (
        <div key={d.day} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div title={`${d.day}: ${d.count}`} style={{ width: "100%", height: `${Math.max((d.count / max) * 70, d.count ? 4 : 1)}px`, background: d.count ? C.gold : C.border, borderRadius: 3 }} />
          <span style={{ fontSize: 8.5, color: C.muted, whiteSpace: "nowrap" }}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Admin page                                                          */
/* ------------------------------------------------------------------ */
export default function AdminPage({ C, onExit }) {
  const [authed, setAuthed] = useState(false);
  const [entered, setEntered] = useState("");
  const [authError, setAuthError] = useState("");
  const [{ accounts, audits }, setData] = useState({ accounts: [], audits: [] });
  const [refreshedAt, setRefreshedAt] = useState(Date.now());

  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    loadAll(entered)
      .then((d) => { setData(d); setLoadError(""); })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [authed, refreshedAt]);

  const stats = useMemo(() => {
    const scored = audits.filter((a) => typeof a.score === "number");
    const avg = scored.length ? Math.round(scored.reduce((t, a) => t + a.score, 0) / scored.length) : null;

    // Activity over the last 14 days
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({
        day: key,
        label: d.getDate(),
        count: audits.filter((a) => new Date(a.date).toISOString().slice(0, 10) === key).length,
        signups: accounts.filter((u) => u.createdAt && new Date(u.createdAt).toISOString().slice(0, 10) === key).length,
      });
    }

    // Score distribution
    const buckets = [
      { label: "0–39 Poor", min: 0, max: 39, color: C.critical },
      { label: "40–59 Average", min: 40, max: 59, color: C.high },
      { label: "60–79 Good", min: 60, max: 79, color: C.medium },
      { label: "80–100 Excellent", min: 80, max: 100, color: C.low },
    ].map((b) => ({ ...b, count: scored.filter((a) => a.score >= b.min && a.score <= b.max).length }));

    // Dimension averages, parsed from the stored report text
    const dimKeys = [["Usability", "usability"], ["Accessibility", "accessibility"], ["Visual Design", "visual"], ["Trust", "trust"], ["Conversion", "conversion"]];
    const dims = dimKeys.map(([label, key]) => {
      const vals = audits.map((a) => a.scorecard && a.scorecard[key]).filter((v) => typeof v === "number");
      return { label, avg: vals.length ? Math.round(vals.reduce((t, v) => t + v, 0) / vals.length) : null, n: vals.length };
    });

    // Severity totals
    const sev = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    audits.forEach((a) => {
      const c = a.severities || {};
      sev.Critical += Number(c.critical) || 0;
      sev.High += Number(c.high) || 0;
      sev.Medium += Number(c.medium) || 0;
      sev.Low += Number(c.low) || 0;
    });

    // Domains audited
    const domainMap = {};
    audits.forEach((a) => {
      if (a.mode === "url" && a.url) {
        try {
          const h = new URL(a.url).hostname.replace(/^www\./, "");
          domainMap[h] = (domainMap[h] || 0) + 1;
        } catch { /* skip */ }
      }
    });
    const domains = Object.entries(domainMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

    // Companies
    const companyMap = {};
    accounts.forEach((u) => {
      const c = (u.company || "").trim();
      if (c) companyMap[c] = (companyMap[c] || 0) + 1;
    });
    const companies = Object.entries(companyMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

    return {
      avg, days, buckets, dims, sev, domains, companies,
      urlCount: audits.filter((a) => a.mode === "url").length,
      fileCount: audits.filter((a) => a.mode !== "url").length,
      verified: accounts.filter((u) => u.emailVerified).length,
      google: accounts.filter((u) => u.provider === "google").length,
      activated: accounts.filter((u) => (Number(u.auditsUsed) || 0) > 0).length,
      quotaUsed: accounts.filter((u) => (Number(u.auditsUsed) || 0) >= 1).length,
    };
  }, [accounts, audits, C]);

  const exportCsv = () => {
    const rows = [["date", "mode", "title", "url", "screens", "score", "assessment"]];
    audits.forEach((a) => rows.push([
      new Date(a.date).toISOString(),
      a.mode || "files",
      (a.title || "").replace(/"/g, "'"),
      a.url || "",
      a.screenCount ?? "",
      a.score ?? "",
      a.assessment || "",
    ]));
    const csv = rows.map((r) => r.map((c) => `"${String(c)}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `redline-audits-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  if (!authed) {
    return (
      <div style={{ maxWidth: 360, margin: "60px auto", textAlign: "center" }}>
        <Lock size={24} color={C.gold} style={{ marginBottom: 12 }} />
        <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 20, color: C.text, margin: "0 0 6px" }}>Admin access</h2>
        <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 16px" }}>Enter the admin key to view analytics.</p>
        <input
          type="password"
          value={entered}
          onChange={(e) => setEntered(e.target.value)}
          placeholder="Admin key"
          style={{ width: "100%", padding: "11px 13px", borderRadius: 9, border: `1px solid ${C.border}`, background: C.raised, color: C.text, fontSize: 13.5, outline: "none" }}
        />
        {authError && <div style={{ marginTop: 10, fontSize: 12.5, color: C.critical }}>{authError}</div>}
        <button
          onClick={async () => {
            setAuthError("");
            try {
              await loadAll(entered);
              setAuthed(true);
            } catch (e) {
              setAuthError(e.message || "That key isn't right.");
            }
          }}
          style={{ width: "100%", marginTop: 14, padding: "12px 0", borderRadius: 999, border: "none", background: C.now, color: C.dark, fontWeight: 700, fontSize: 14, cursor: "pointer" }}
        >
          Unlock
        </button>
        <button onClick={onExit} style={{ background: "none", border: "none", color: C.muted, fontSize: 12.5, marginTop: 12, cursor: "pointer" }}>Back to Redline</button>
      </div>
    );
  }

  const maxDim = 100;
  const maxSev = Math.max(...Object.values(stats.sev), 1);

  return (
    <div style={{ paddingTop: 8, paddingBottom: 40 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 800, fontSize: 26, color: C.text, margin: "0 0 2px", letterSpacing: -0.5 }}>Analytics</h1>
          <div style={{ fontSize: 12.5, color: C.muted }}>{accounts.length} account{accounts.length === 1 ? "" : "s"} · {audits.length} audit{audits.length === 1 ? "" : "s"}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setRefreshedAt(Date.now())} style={{ display: "flex", alignItems: "center", gap: 5, background: "transparent", border: `1px solid ${C.border}`, color: C.muted, fontSize: 12, borderRadius: 999, padding: "8px 13px", cursor: "pointer" }}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={exportCsv} style={{ display: "flex", alignItems: "center", gap: 5, background: C.now, color: C.dark, border: "none", fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "8px 13px", cursor: "pointer" }}>
            <Download size={12} /> CSV
          </button>
        </div>
      </div>

      {loadError && (
        <div style={{ background: C.criticalSoft, border: `1px solid ${C.critical}44`, borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12.5, color: C.critical }}>
          {loadError}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
        <StatCard C={C} icon={Users} label="Accounts" value={accounts.length} sub={`${stats.verified} email-verified`} />
        <StatCard C={C} icon={FileText} label="Audits run" value={audits.length} sub={`${stats.activated} account${stats.activated === 1 ? "" : "s"} activated`} />
        <StatCard C={C} icon={Gauge} label="Avg score" value={stats.avg ?? "—"} sub={stats.avg != null ? "across scored audits" : "no scored audits yet"} />
        <StatCard C={C} icon={TrendingUp} label="Activation" value={accounts.length ? `${Math.round((stats.activated / accounts.length) * 100)}%` : "—"} sub="signed up → ran an audit" />
      </div>

      <Panel C={C} title="Activity — last 14 days" icon={Clock} note="Audits completed per day">
        <Sparkline data={stats.days} C={C} />
      </Panel>

      <Panel C={C} title="Audit type" icon={BarChart3} note="How people submit work for review">
        <BarRow C={C} label="URL reviews" value={stats.urlCount} max={Math.max(audits.length, 1)} color={C.gold} />
        <BarRow C={C} label="Screens / PDFs" value={stats.fileCount} max={Math.max(audits.length, 1)} color={C.medium} />
      </Panel>

      <Panel C={C} title="Score distribution" icon={Gauge} note="How the audited products rate overall">
        {stats.buckets.map((b) => (
          <BarRow key={b.label} C={C} label={b.label} value={b.count} max={Math.max(...stats.buckets.map((x) => x.count), 1)} color={b.color} />
        ))}
      </Panel>

      <Panel C={C} title="Average score by dimension" icon={BarChart3} note="Where audited products are strongest and weakest">
        {stats.dims.map((d) => (
          <BarRow key={d.label} C={C} label={d.label} value={d.avg ?? 0} max={maxDim} suffix={d.avg == null ? "" : ""} color={d.avg == null ? C.border : d.avg >= 70 ? C.low : d.avg >= 50 ? C.high : C.critical} />
        ))}
      </Panel>

      <Panel C={C} title="Findings by severity" icon={AlertCircle} note="Total issues raised across all reports">
        <BarRow C={C} label="Critical" value={stats.sev.Critical} max={maxSev} color={C.critical} />
        <BarRow C={C} label="High" value={stats.sev.High} max={maxSev} color={C.high} />
        <BarRow C={C} label="Medium" value={stats.sev.Medium} max={maxSev} color={C.medium} />
        <BarRow C={C} label="Low" value={stats.sev.Low} max={maxSev} color={C.low} />
      </Panel>

      {stats.domains.length > 0 && (
        <Panel C={C} title="Most audited domains" icon={Globe}>
          {stats.domains.map(([d, n]) => (
            <BarRow key={d} C={C} label={d} value={n} max={stats.domains[0][1]} />
          ))}
        </Panel>
      )}

      {stats.companies.length > 0 && (
        <Panel C={C} title="Companies signing up" icon={Building2}>
          {stats.companies.map(([c, n]) => (
            <BarRow key={c} C={C} label={c} value={n} max={stats.companies[0][1]} />
          ))}
        </Panel>
      )}

      <Panel C={C} title="Accounts" icon={Users} note="Registered on this device">
        {accounts.length === 0 ? (
          <div style={{ fontSize: 13, color: C.muted, fontStyle: "italic" }}>No accounts stored in this browser.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", color: C.muted }}>
                  {["Email", "Name", "Company", "Audits", "Joined"].map((h) => (
                    <th key={h} style={{ padding: "6px 8px", fontWeight: 700, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map((u) => (
                  <tr key={u.emailHash}>
                    <td style={{ padding: "7px 8px", borderBottom: `1px solid ${C.borderSoft}`, color: C.text }}>{u.email}</td>
                    <td style={{ padding: "7px 8px", borderBottom: `1px solid ${C.borderSoft}`, color: C.textDim }}>{u.name || "—"}</td>
                    <td style={{ padding: "7px 8px", borderBottom: `1px solid ${C.borderSoft}`, color: C.textDim }}>{u.company || "—"}</td>
                    <td style={{ padding: "7px 8px", borderBottom: `1px solid ${C.borderSoft}`, color: C.textDim }}>{Number(u.auditsUsed) || 0}</td>
                    <td style={{ padding: "7px 8px", borderBottom: `1px solid ${C.borderSoft}`, color: C.muted, whiteSpace: "nowrap" }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <button onClick={onExit} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.muted, fontSize: 12.5, borderRadius: 999, padding: "9px 16px", cursor: "pointer" }}>
        Back to Redline
      </button>
    </div>
  );
}
