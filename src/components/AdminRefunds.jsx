import { useCallback, useEffect, useState } from "react";

function money(cents, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: (currency || "USD").toUpperCase() }).format((cents || 0) / 100);
}

export default function AdminRefunds({ adminKey }) {
  const [requests, setRequests] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [unlinked, setUnlinked] = useState([]);
  const [refundEvents, setRefundEvents] = useState([]);
  const [apiRefundsEnabled, setApiRefundsEnabled] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = useCallback(async (action, extra = {}) => {
    const response = await fetch("/api/admin-refunds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: adminKey, action, ...extra }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Refund administration request failed.");
    return data;
  }, [adminKey]);

  const refresh = useCallback(async () => {
    const data = await send("list");
    setRequests(data.requests || []);
    setPurchases(data.purchases || []);
    setUnlinked(data.unlinkedPurchases || []);
    setRefundEvents(data.refundEvents || []);
    setApiRefundsEnabled(data.apiRefundsEnabled === true);
  }, [send]);

  useEffect(() => {
    refresh().catch(e => setError(e.message));
  }, [refresh]);

  async function run(action, values, success) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await send(action, values);
      await refresh();
      setMessage(success || result.note || "Updated.");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <section style={{ marginTop: 24, padding: 18, border: "1px solid #cddfd7", background: "#fff", borderRadius: 14 }}>
    <h2 style={{ marginTop: 0 }}>Refund requests & reconciliation</h2>
    <p style={{ fontSize: 13, lineHeight: 1.6 }}>
      Approving a request is not a payment refund. Issue an approved refund in your Creem dashboard;
      UXNest deducts credits only after a verified refund webhook.
    </p>
    {!apiRefundsEnabled && <p style={{ fontSize: 12 }}>Creem API refunds are disabled. Issue full refunds through your Creem dashboard after approval.</p>}
    <button disabled={busy} onClick={() => refresh().catch(e => setError(e.message))}>Refresh</button>
    {error && <p role="alert" style={{ color: "#a32323" }}>{error}</p>}
    {message && <p role="status" style={{ color: "#15634e" }}>{message}</p>}
    <h3 style={{ fontSize: 15 }}>Requests ({requests.length})</h3>
    {!requests.length && <p>No refund requests.</p>}
    {requests.map(request => {
      const purchase = purchases.find(p => p.id === request.purchase_id);
      return <article key={request.id} style={{ borderTop: "1px solid #e0e8e4", padding: "12px 0" }}>
        <strong>{request.status}</strong> · <small>{new Date(request.created_at).toLocaleString()}</small>
        <p style={{ margin: "8px 0" }}>{request.reason}</p>
        <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>Purchase ID: {request.purchase_id}</div>
        {purchase && <p style={{ fontSize: 13 }}>
          {purchase.quantity} credits · {money(purchase.amount_cents, purchase.currency)} · {purchase.payment_provider || "Provider unknown"}
          <span style={{ display: "block", overflowWrap: "anywhere" }}>Transaction: {purchase.creem_transaction_id || "Not linked"}</span>
        </p>}
        {purchase?.refund_status && purchase.refund_status !== "none" && <p style={{ fontSize: 12 }}>Payment refund state: <strong>{purchase.refund_status}</strong></p>}
        {request.status === "approved" && apiRefundsEnabled && purchase?.refund_status === "none" &&
          <button disabled={busy} onClick={() => {
            if (window.confirm("Issue an IRREVERSIBLE FULL REFUND in Creem for this payment? No automatic retry will be attempted.")) {
              run("issue_full_refund", { requestId: request.id, confirm: "ISSUE_FULL_REFUND" },
                "Full refund submitted to Creem. Awaiting confirmation webhook.");
            }
          }}>Issue full refund in Creem</button>}
        {["requested", "reviewing"].includes(request.status) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button disabled={busy} onClick={() => run("review", { requestId: request.id, decision: "approved" }, "Approved for refund processing. Issue the refund in Creem.")}>Approve</button>
          <button disabled={busy} onClick={() => run("review", { requestId: request.id, decision: "rejected" }, "Refund request rejected.")}>Reject</button>
          <button disabled={busy} onClick={() => run("review", { requestId: request.id, decision: "reviewing" }, "Marked for review.")}>Mark reviewing</button>
        </div>}
      </article>;
    })}
    <h3 style={{ fontSize: 15 }}>Purchases missing a Creem transaction ID ({unlinked.length})</h3>
    {!unlinked.length && <p>All recorded Creem purchases have a transaction ID.</p>}
    {unlinked.map(p => <div key={p.id} style={{ borderTop: "1px solid #e0e8e4", padding: "12px 0" }}>
      <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>Checkout: {p.creem_checkout_id || "Unknown"}</div>
      <small>{money(p.amount_cents, "USD")} · {p.quantity} credits · {new Date(p.created_at).toLocaleDateString()}</small>
      <div><button disabled={busy || !p.creem_checkout_id} onClick={() => run("sync_purchase", { purchaseId: p.id }, "Reconciliation completed; review transaction linkage.")}>Sync from Creem</button></div>
    </div>)}
    <h3 style={{ fontSize: 15 }}>Refund webhooks requiring attention ({refundEvents.length})</h3>
    {!refundEvents.length && <p>No unresolved refund events.</p>}
    {refundEvents.map(event => <article key={event.event_id} style={{ borderTop: "1px solid #e0e8e4", padding: "12px 0" }}>
      <strong>{event.state.replace(/_/g, " ")}</strong> · <small>{new Date(event.received_at).toLocaleString()}</small>
      <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>Event: {event.event_id} · Transaction: {event.transaction_id || "Not supplied"}</div>
      <p style={{ fontSize: 13 }}>{money(event.amount_cents, event.currency)} · Provider status: {event.refund_status || "Unknown"} / {event.transaction_status || "Unknown"}</p>
      {event.detail && <p style={{ fontSize: 12 }}>{event.detail}</p>}
      {event.refund_status === "succeeded" && event.currency?.toLowerCase() === "usd" && !!event.transaction_id && <button disabled={busy} onClick={() => run("retry_event", { eventId: event.event_id }, "Verified refund reconciled; audit credits adjusted.")}>Verify and reconcile</button>}
    </article>)}
  </section>;
}
