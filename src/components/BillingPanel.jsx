import { useEffect, useState } from "react";

export default function BillingPanel({ getToken, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  async function call(action, extra = {}) {
    const response = await fetch("/api/billing", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: getToken(), action, ...extra })
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || "Billing request failed.");
    return json;
  }
  async function refresh() {
    setLoading(true); setError("");
    try { setData(await call("history")); } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);
  async function requestRefund() {
    if (!selected || reason.trim().length < 5) return;
    setSending(true); setError("");
    try {
      await call("request_refund", { purchaseId: selected, reason: reason.trim() });
      setSelected(null); setReason(""); await refresh();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }
  const style = { border: "1px solid #d9e6e1", borderRadius: 12, padding: 14, background: "#fff" };
  return <section aria-label="Billing and purchases" style={{ ...style, margin: "16px auto", maxWidth: 720 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>Billing & Purchases</h2>
      <button onClick={onClose} aria-label="Close billing">Close</button>
    </div>
    {loading && <p>Loading purchases…</p>}
    {error && <p role="alert" style={{ color: "#a42323" }}>{error}</p>}
    {data && <>
      <p><strong>{data.availableCredits}</strong> available paid audit credits</p>
      <p style={{ fontSize: 12, lineHeight: 1.55, color: "#48665E", marginTop: 0 }}>For eligibility and processing details, read the <a href="/#legal-refunds" target="_blank" rel="noopener noreferrer" style={{ color: "#12654F", fontWeight: 700 }}>Refund Policy</a>. Payment invoices and refunds are handled by Creem.</p>
      {data.creditAdjustmentDue > 0 && <p style={{ fontSize: 13 }}>Credit adjustment: {data.creditAdjustmentDue} previously refunded credit(s) were already used. Future credit purchases will settle this balance first.</p>}
      {!data.purchases.length && <p>No purchases recorded for this account yet.</p>}
      {data.purchases.map(p => {
        const request = data.refunds.find(r => r.purchase_id === p.id);
        return <div key={p.id} style={{ ...style, marginBottom: 10, background: "#f8fbfa" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <strong>{p.quantity} audit credit{p.quantity === 1 ? "" : "s"}</strong>
            <strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: (p.currency || "USD").toUpperCase() }).format(p.amount_cents / 100)}</strong>
          </div>
          <small>{new Date(p.created_at).toLocaleDateString()} · {p.payment_provider || "Payment"} · {p.refund_status !== "none" ? p.refund_status : "Paid"}</small>
          <div style={{ fontSize: 12, marginTop: 6, overflowWrap: "anywhere" }}>Purchase ID: {p.id}</div>
          {request ? <p>Refund request: <strong>{request.status}</strong></p> :
            p.refund_status === "none" && <button style={{ marginTop: 8 }} onClick={() => setSelected(p.id)}>Request refund</button>}
          {selected === p.id && <div style={{ marginTop: 10 }}>
            <label htmlFor={"reason-" + p.id}>Reason for refund</label>
            <textarea id={"reason-" + p.id} value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} rows={3} style={{ display: "block", width: "100%", marginTop: 6 }} />
            <p style={{ fontSize: 12 }}>Submitting a request does not guarantee approval or automatically issue a refund.</p>
            <button disabled={sending || reason.trim().length < 5} onClick={requestRefund}>{sending ? "Submitting…" : "Submit request"}</button>
            <button style={{ marginLeft: 8 }} onClick={() => { setSelected(null); setReason(""); }}>Cancel</button>
          </div>}
        </div>;
      })}
    </>}
  </section>;
}
