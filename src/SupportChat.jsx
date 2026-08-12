import { useState, useRef, useEffect } from "react";
import { X, Send, Loader2, Check, Sparkles } from "lucide-react";

/* Knowledge the agent answers from. Kept explicit rather than left to the
   model's guesswork, so it can't invent features UXNest doesn't have. */
const SUPPORT_CONTEXT = `You are the support agent for UXNest (uxnest.ai), an AI-powered UX audit platform.

WHAT THE PRODUCT DOES
- Nest Audit reviews a design across six dimensions: usability, visual design, accessibility, trust & credibility, conversion, and cognitive load.
- Three input types: screenshots (PNG/JPG/WEBP), PDF documents, and website URLs.
- URL audits explore the homepage plus up to 5 main navigation pages by reading page content and structure. They are not pixel-level visual audits — for that, upload screenshots.
- Output: a full report with severity-rated findings and fixes, AI recommendations, a Top 10 ranked improvement list, quick wins, strategic improvements, and a scorecard.
- Reports can be viewed as a 12-slide presentation deck and downloaded as a PDF, or emailed as a summary with a link back to the site.

ACCOUNTS AND LIMITS
- A free instant preview runs on the landing page with no account: score plus top three issues.
- Full audits require a free account. Signup asks for name, company, email and password; mobile number is optional. Email verification by 6-digit code is required.
- Each account includes 5 full audits. Up to 5 screens or 5 pages per audit.
- Audits are saved to My Audits and sync across devices.
- Everything is free during early access. There is no paid plan and no card required.

KNOWN LIMITATIONS — be honest about these
- There is no password reset yet. If someone is locked out, escalate to support.
- Some sites block automated access (large retailers especially); if a URL audit fails that way, suggest uploading screenshots instead.
- Audits take roughly 1-3 minutes; the preview takes about 15 seconds.
- Reports cannot yet be shared by public link — users can download the PDF and send that.
- The audit is AI-generated analysis, not a certified accessibility audit or legal advice.

WHEN THE USER HAS A REPORT OPEN
- Their audit is included below. Answer questions about it directly and specifically: why a score is low, what a finding means, what to fix first, how to implement a recommendation, how issues relate to each other.
- Quote their actual findings rather than speaking generally. If they ask "what should I fix first?", use the ranked improvements and severities in their report.
- You may give practical UX and implementation advice that goes beyond the report — concrete patterns, examples, trade-offs — as long as it's grounded in what their audit actually found.
- If they ask about something the audit didn't cover, say so rather than inventing a finding.

HOW TO BEHAVE
- Be brief, warm and specific. Two or three sentences is usually right, longer when explaining a fix.
- Answer only from the information above. If you do not know, say so plainly.
- Never invent features, prices, timelines or policies.
- If the user has a problem you cannot solve from the above — a bug, a lockout, billing, data deletion, anything needing a human — tell them you'll pass it to the team, and end your message with the exact token [ESCALATE] on its own line. Do not use that token otherwise.`;

/* Compresses the current report into a short brief the assistant can reason
   over. Sending the whole report would blow the token budget on every turn,
   so this keeps titles, severities and recommendations — the parts users
   actually ask about — and drops the prose. */
function buildReportBrief(report, source) {
  if (!report) return "";
  const src = source && source.mode === "url" && source.url ? source.url : "uploaded screens";
  const lines = [`THE USER'S CURRENT AUDIT — ${src}`];
  lines.push(`Overall score: ${report.summary.score ?? "unknown"}/100 (${report.summary.assessment ?? "unrated"})`);

  const sc = report.scorecard || {};
  lines.push(`Dimension scores — usability ${sc.usability ?? "?"}, accessibility ${sc.accessibility ?? "?"}, visual design ${sc.visual ?? "?"}, trust ${sc.trust ?? "?"}, conversion ${sc.conversion ?? "?"}`);

  if (report.summary.concerns?.length) {
    lines.push(`Top concerns: ${report.summary.concerns.join("; ")}`);
  }

  const sections = [
    ["Usability", report.usability],
    ["Visual design", report.visual],
    ["Accessibility", report.accessibility],
    ["Trust", report.trust],
    ["Conversion", report.conversion],
    ["Cognitive load", report.cognitive],
  ];
  sections.forEach(([label, sec]) => {
    if (!sec?.issues?.length) return;
    lines.push(`\n${label} findings:`);
    sec.issues.forEach((i) => {
      lines.push(`- [${i.severity}] ${i.title} — why: ${String(i.why).slice(0, 200)} — fix: ${String(i.recommendation).slice(0, 200)}`);
    });
  });

  if (report.top10?.length) {
    lines.push("\nTop ranked improvements:");
    report.top10.slice(0, 10).forEach((t) => lines.push(`${t.rank}. ${t.recommendation}`));
  }
  if (report.quickWins?.length) lines.push(`\nQuick wins: ${report.quickWins.join("; ")}`);
  if (report.scorecard?.verdict) lines.push(`\nVerdict: ${report.scorecard.verdict}`);

  return lines.join("\n").slice(0, 9000);
}

export default function SupportChat({ C, user, report, source }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm the UXNest assistant. Ask me anything about your audit, running new ones, or your account." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("chat"); // chat | escalate | sent
  const [email, setEmail] = useState(user?.email || "");
  const [ticketRef, setTicketRef] = useState("");
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, mode, open]);

  useEffect(() => {
    if (user?.email) setEmail(user.email);
  }, [user]);

  // Offer to talk through a report as soon as one is available.
  const announcedRef = useRef(false);
  useEffect(() => {
    if (!report || announcedRef.current) return;
    announcedRef.current = true;
    setMessages((prev) => [...prev, {
      role: "assistant",
      content: `I can see your audit${report.summary?.score != null ? ` — it scored ${report.summary.score}/100` : ""}. Ask me anything about it: why a score came out that way, what to fix first, or how to implement any recommendation.`,
    }]);
  }, [report]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");

    try {
      const r = await fetch("/api/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          max_tokens: 900,
          messages: [
            { role: "user", content: [{ type: "text", text: `${SUPPORT_CONTEXT}\n\n${buildReportBrief(report, source)}\n\nConversation so far:\n${next.map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`).join("\n")}\n\nReply as the agent to the last user message.` }] },
          ],
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || data.error || "Support is unavailable right now.");
      let reply = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();

      const escalate = reply.includes("[ESCALATE]");
      reply = reply.replace(/\[ESCALATE\]/g, "").trim();

      setMessages([...next, { role: "assistant", content: reply }]);
      if (escalate) setMode("escalate");
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const submitTicket = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const r = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          message: lastUser ? lastUser.content : "Support requested from chat",
          transcript: messages,
          page: typeof window !== "undefined" ? window.location.href : "",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Couldn't send the request.");
      setTicketRef(data.ref || "");
      setMode("sent");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open AI assistant"
        style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 60,
          width: 52, height: 52, borderRadius: "50%", border: "none",
          background: C.gold, color: "#FFFFFF", cursor: "pointer",
          boxShadow: "0 8px 24px rgba(18,48,43,0.28)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Sparkles size={22} />
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed", bottom: 16, right: 16, left: 16, zIndex: 60,
        maxWidth: 380, marginLeft: "auto",
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16,
        boxShadow: "0 16px 44px rgba(18,48,43,0.25)", overflow: "hidden",
        display: "flex", flexDirection: "column", maxHeight: "min(560px, 80vh)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: C.dark }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={16} color={C.now} />
          <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 700, fontSize: 14, color: "#FFFFFF" }}>UXNest AI Assistant</span>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: "transparent", border: "none", cursor: "pointer", display: "flex" }}>
          <X size={17} color="#BFD8D2" />
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 10 }}>
            <div style={{
              maxWidth: "86%", padding: "9px 12px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.55,
              background: m.role === "user" ? C.goldSoft : C.bg,
              color: C.text,
              border: `1px solid ${m.role === "user" ? `${C.gold}33` : C.borderSoft}`,
              whiteSpace: "pre-wrap",
            }}>
              {m.content}
            </div>
          </div>
        ))}

        {busy && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted, fontSize: 12.5, padding: "4px 2px" }}>
            <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Thinking…
          </div>
        )}

        {mode === "escalate" && (
          <div style={{ background: C.goldSoft, border: `1px solid ${C.gold}44`, borderRadius: 12, padding: 12, marginTop: 6 }}>
            <div style={{ fontSize: 12.5, color: C.text, marginBottom: 8, lineHeight: 1.5 }}>
              I'll pass this to the team. Where should they reply?
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              style={{ width: "100%", padding: "9px 11px", borderRadius: 8, border: `1px solid ${C.border}`, background: "#FFFFFF", color: C.text, fontSize: 13, outline: "none" }}
            />
            <button
              onClick={submitTicket}
              disabled={busy}
              style={{ width: "100%", marginTop: 8, padding: "10px 0", borderRadius: 999, border: "none", background: C.now, color: C.dark, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              Send to support
            </button>
          </div>
        )}

        {mode === "sent" && (
          <div style={{ background: C.lowSoft, border: `1px solid ${C.low}44`, borderRadius: 12, padding: 12, marginTop: 6, display: "flex", gap: 9 }}>
            <Check size={16} color={C.low} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.55 }}>
              Sent{ticketRef ? ` — reference ${ticketRef}` : ""}. We'll reply to {email} by email.
            </div>
          </div>
        )}

        {error && <div style={{ fontSize: 12.5, color: C.critical, marginTop: 8 }}>{error}</div>}
      </div>

      {report && messages.length <= 2 && mode === "chat" && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 12px 10px" }}>
          {["What should I fix first?", "Why is my score low?", "Explain the top issue"].map((q) => (
            <button
              key={q}
              onClick={() => { setInput(q); }}
              style={{ background: C.goldSoft, border: `1px solid ${C.gold}33`, color: C.gold, fontSize: 11.5, fontWeight: 600, borderRadius: 999, padding: "6px 11px", cursor: "pointer" }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {mode !== "sent" && (
        <div style={{ display: "flex", gap: 8, padding: 12, borderTop: `1px solid ${C.borderSoft}` }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about your audit…"
            style={{ flex: 1, padding: "10px 12px", borderRadius: 999, border: `1px solid ${C.border}`, background: C.raised, color: C.text, fontSize: 13.5, outline: "none" }}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            aria-label="Send"
            style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: input.trim() ? C.now : C.surfaceAlt, color: C.dark, cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <Send size={16} />
          </button>
        </div>
      )}

      <div style={{ padding: "0 12px 10px", fontSize: 10.5, color: C.muted, textAlign: "center" }}>
        AI assistant — it can be wrong. Ask for a human any time.
      </div>
    </div>
  );
}
