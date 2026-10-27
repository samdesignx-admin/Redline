import React, { useEffect, useState } from "react";

const COLORS = {
  ink: "#173B33", muted: "#557269", green: "#13765E",
  border: "#D8E8E1", tint: "#F1FAF6", white: "#FFFFFF",
};
const cardStyle = {
  background: COLORS.white, border: "1px solid " + COLORS.border,
  borderRadius: 16, padding: 18, marginBottom: 14,
};
const fieldStyle = {
  width: "100%", border: "1px solid #BBD3C9", background: "#fff",
  borderRadius: 10, padding: "12px 13px", color: COLORS.ink,
  fontSize: 14, fontFamily: "inherit",
};
const buttonStyle = {
  border: "none", borderRadius: 10, padding: "11px 16px",
  background: "#0F8069", color: "#fff", fontSize: 13,
  fontWeight: 750, cursor: "pointer",
};
function paymentLabel(p) {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency", currency: (p.currency || "USD").toUpperCase(),
  }).format(Number(p.amount_cents || 0) / 100);
  return `${new Date(p.created_at).toLocaleDateString()} · ${amount} · ${p.quantity} audit credit${p.quantity === 1 ? "" : "s"}`;
}

export default function HelpPage({ getToken, user, onLogin, onClose }) {
  const [refundSectionOpen, setRefundSectionOpen] = useState(false);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [refundSuccess, setRefundSuccess] = useState("");
  const [selectedPurchaseId, setSelectedPurchaseId] = useState("");
  const [reason, setReason] = useState("");
  const [requestLoading, setRequestLoading] = useState(false);
  const [supportEmail, setSupportEmail] = useState(user?.email || "");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportResult, setSupportResult] = useState("");
  const [supportError, setSupportError] = useState("");

  useEffect(() => { if (user?.email) setSupportEmail(user.email); }, [user?.email]);

  async function billingCall(action, extra = {}) {
    const response = await fetch("/api/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: getToken(), action, ...extra }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Unable to process your request.");
    return result;
  }

  async function loadHistory() {
    if (!user) return;
    setHistoryLoading(true);
    setRefundError("");
    try {
      const result = await billingCall("history");
      setHistory(result);
    } catch (error) {
      setRefundError(error.message || "Unable to load purchases.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (refundSectionOpen && user) loadHistory();
    // Loading is intentionally tied to the section opening and account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refundSectionOpen, user?.id]);

  const requestablePurchases = (history?.purchases || []).filter((p) =>
    (!p.refund_status || p.refund_status === "none") &&
    !(history?.refunds || []).some((r) => r.purchase_id === p.id)
  );

  async function submitRefund(event) {
    event.preventDefault();
    if (requestLoading || !selectedPurchaseId || reason.trim().length < 5) return;
    setRequestLoading(true);
    setRefundError("");
    setRefundSuccess("");
    try {
      await billingCall("request_refund", {
        purchaseId: selectedPurchaseId,
        reason: reason.trim(),
      });
      setRefundSuccess("Your request has been submitted for review. No refund has been issued yet.");
      setSelectedPurchaseId("");
      setReason("");
      await loadHistory();
    } catch (error) {
      setRefundError(error.message || "Unable to submit the refund request.");
    } finally {
      setRequestLoading(false);
    }
  }

  async function submitSupport(event) {
    event.preventDefault();
    if (supportLoading || supportMessage.trim().length < 5) return;
    setSupportLoading(true);
    setSupportResult("");
    setSupportError("");
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: supportEmail.trim(),
          message: supportMessage.trim(),
          page: "help-center",
          transcript: [],
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to send your message.");
      setSupportResult("Message sent" + (result.ref ? " · Reference " + result.ref : "") + ". We'll reply by email.");
      setSupportMessage("");
    } catch (error) {
      setSupportError(error.message || "Unable to contact support.");
    } finally {
      setSupportLoading(false);
    }
  }

  return (
    <section aria-label="Help and support" style={{ maxWidth: 720, margin: "0 auto 28px", color: COLORS.ink }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <div>
          <div style={{ color: COLORS.green, letterSpacing: 2, fontSize: 10, fontWeight: 800 }}>UXNEST SUPPORT</div>
          <h1 style={{ fontSize: "clamp(23px, 5vw, 28px)", fontWeight: 850, margin: "6px 0 0" }}>Help & Support</h1>
        </div>
        <button type="button" onClick={onClose} style={{ border: "1px solid " + COLORS.border, background: "#fff", borderRadius: 10, padding: "9px 13px", cursor: "pointer", color: COLORS.ink }}>Back</button>
      </header>

      <div style={{ ...cardStyle, background: COLORS.tint }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, margin: "0 0 8px" }}>How can we help?</h2>
        <p style={{ color: COLORS.muted, lineHeight: 1.65, fontSize: 13, margin: 0 }}>
          Get assistance with audit results, account access, billing issues or other questions.
          You can also use the support chat in the bottom-right corner.
        </p>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Frequently asked questions</h2>
        <details style={{ borderBottom: "1px solid " + COLORS.border, padding: "9px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 650, fontSize: 14 }}>Why couldn't UXNest audit my website?</summary>
          <p style={{ color: COLORS.muted, lineHeight: 1.6, fontSize: 13 }}>Some websites block automated access. You can audit screenshots or a public page instead. An inaccessible website does not automatically mean it has a UX problem.</p>
        </details>
        <details style={{ borderBottom: "1px solid " + COLORS.border, padding: "9px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 650, fontSize: 14 }}>My payment succeeded, but credits are missing</summary>
          <p style={{ color: COLORS.muted, lineHeight: 1.6, fontSize: 13 }}>Sign in to the same account used at checkout, check Billing & Purchases, and share your purchase reference with support. Please don't submit card numbers.</p>
        </details>
        <details style={{ padding: "9px 0" }}>
          <summary style={{ cursor: "pointer", fontWeight: 650, fontSize: 14 }}>Can I access or delete my account data?</summary>
          <p style={{ color: COLORS.muted, lineHeight: 1.6, fontSize: 13 }}>You can request access or deletion using the contact form below. We may verify account ownership. See our <a href="/#legal-privacy" style={{ color: COLORS.green }}>Privacy Policy</a>.</p>
        </details>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Contact the UXNest team</h2>
        <p style={{ color: COLORS.muted, fontSize: 13, lineHeight: 1.6 }}>Describe the issue and we'll follow up by email. Please don't include passwords or payment card details.</p>
        <form onSubmit={submitSupport} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 650 }}>
            Email address
            <input type="email" required autoComplete="email" value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} style={fieldStyle} />
          </label>
          <label style={{ display: "grid", gap: 5, fontSize: 13, fontWeight: 650 }}>
            What can we help you with?
            <textarea value={supportMessage} required minLength={5} maxLength={3000} rows={4} onChange={(e) => setSupportMessage(e.target.value)} style={{ ...fieldStyle, resize: "vertical" }} placeholder="Tell us what happened…" />
          </label>
          <div><button type="submit" disabled={supportLoading || supportMessage.trim().length < 5} style={{ ...buttonStyle, opacity: supportLoading ? 0.6 : 1 }}>{supportLoading ? "Sending…" : "Send message"}</button></div>
          {supportResult && <p role="status" style={{ color: COLORS.green, margin: 0, fontSize: 13 }}>{supportResult}</p>}
          {supportError && <p role="alert" style={{ color: "#A42632", margin: 0, fontSize: 13 }}>{supportError}</p>}
        </form>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: "0 0 8px", fontSize: 16 }}>Billing questions & refunds</h2>
        <p style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.65 }}>
          Purchased audit credits are subject to the <a href="/#legal-refunds" style={{ color: COLORS.green, fontWeight: 650 }}>Refund Policy</a>, including the standard request window and exceptions for service problems or legal rights. Creem processes refunds after review.
        </p>
        <details onToggle={(event) => setRefundSectionOpen(event.currentTarget.open)}
          style={{ border: "1px solid " + COLORS.border, borderRadius: 12, padding: "13px 15px", background: COLORS.tint }}>
          <summary style={{ cursor: "pointer", fontWeight: 750, fontSize: 14 }}>Refund requests and status</summary>
          <div style={{ marginTop: 15, fontSize: 13 }}>
            {!user ? (
              <div>
                <p style={{ color: COLORS.muted }}>Sign in to review refund requests or submit a request related to your purchases.</p>
                <button type="button" style={buttonStyle} onClick={onLogin}>Log in to continue</button>
              </div>
            ) : (
              <>
                {historyLoading && <p role="status">Loading purchase records…</p>}
                {refundError && <p role="alert" style={{ color: "#A42632" }}>{refundError}</p>}
                {refundSuccess && <p role="status" style={{ color: COLORS.green }}>{refundSuccess}</p>}
                {history && (
                  <>
                    {(history.refunds || []).length > 0 && (
                      <div style={{ marginBottom: 18 }}>
                        <strong style={{ display: "block", marginBottom: 8 }}>Existing requests</strong>
                        {history.refunds.map((r) => (
                          <div key={r.id} style={{ marginBottom: 8, borderBottom: "1px solid " + COLORS.border, paddingBottom: 8, color: COLORS.muted }}>
                            {new Date(r.created_at).toLocaleDateString()} · <strong>{r.status}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                    {requestablePurchases.length ? (
                      <form onSubmit={submitRefund} style={{ display: "grid", gap: 12 }}>
                        <p style={{ lineHeight: 1.5, color: COLORS.muted, margin: 0 }}>Select the purchase you need help with. Your request will be reviewed before any refund is processed.</p>
                        <label style={{ display: "grid", gap: 5, fontWeight: 650 }}>
                          Purchase
                          <select required value={selectedPurchaseId} onChange={(e) => setSelectedPurchaseId(e.target.value)} style={fieldStyle}>
                            <option value="">Choose a purchase</option>
                            {requestablePurchases.map((p) => <option value={p.id} key={p.id}>{paymentLabel(p)}</option>)}
                          </select>
                        </label>
                        <label style={{ display: "grid", gap: 5, fontWeight: 650 }}>
                          Reason for your request
                          <textarea required minLength={5} maxLength={1000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...fieldStyle, resize: "vertical" }} placeholder="Describe the payment or service issue…" />
                        </label>
                        <div>
                          <button type="submit" disabled={requestLoading || !selectedPurchaseId || reason.trim().length < 5} style={{ ...buttonStyle, opacity: requestLoading ? 0.6 : 1 }}>
                            {requestLoading ? "Submitting…" : "Submit refund request"}
                          </button>
                        </div>
                        <small style={{ color: COLORS.muted, lineHeight: 1.6 }}>A request does not automatically approve or issue a refund. For exceptions or missing purchases, use the contact form above.</small>
                      </form>
                    ) : <p style={{ color: COLORS.muted }}>No purchases are currently available for a new refund request. For billing questions, use the contact form above.</p>}
                  </>
                )}
              </>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
