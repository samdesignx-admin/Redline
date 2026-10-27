import { useEffect, useState } from "react";

// Account page: purchases, credit balance and payment/refund statuses only.
// Refund requests live in the separate Help & Support page.
export default function BillingPanel({ getToken, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/billing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: getToken(), action: "history" }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json.error || "Unable to load purchases.");
        if (active) setData(json);
      } catch (err) {
        if (active) setError(err.message || "Unable to load purchases.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [getToken]);

  const panel = { background: "#fff", border: "1px solid #D9E6E1", borderRadius: 16, padding: "18px" };
  const money = (p) => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (p.currency || "USD").toUpperCase(),
  }).format(Number(p.amount_cents || 0) / 100);

  return (
    <section aria-label="Billing and purchases" style={{ maxWidth: 720, margin: "0 auto 24px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ textTransform: "uppercase", color: "#12816B", fontSize: 10, letterSpacing: 2, fontWeight: 750 }}>Your account</div>
          <h1 style={{ color: "#163831", fontSize: "clamp(22px, 5vw, 27px)", margin: "5px 0 0", fontWeight: 850 }}>Billing & Purchases</h1>
        </div>
        <button type="button" onClick={onClose} style={{ border: "1px solid #D9E6E1", background: "#fff", borderRadius: 9, padding: "8px 12px", color: "#315950", cursor: "pointer" }}>Back</button>
      </header>
      {loading && <p role="status" style={{ color: "#54766C" }}>Loading purchase history…</p>}
      {error && <p role="alert" style={{ color: "#AA2835" }}>{error}</p>}
      {data && (
        <>
          <div style={{ ...panel, marginBottom: 18, background: "#EDF8F4" }}>
            <div style={{ fontSize: 12, color: "#49796D", marginBottom: 4 }}>Available paid audit credits</div>
            <div style={{ fontSize: 30, fontWeight: 850, color: "#14624E" }}>{data.availableCredits ?? 0}</div>
            {data.creditAdjustmentDue > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "#42665D" }}>
                {data.creditAdjustmentDue} previously refunded credit(s) were already used. Future purchases will settle this adjustment first.
              </p>
            )}
          </div>
          <h2 style={{ fontSize: 16, color: "#173C33", marginBottom: 12 }}>Purchase history</h2>
          {!data.purchases?.length && <div style={panel}>No purchases recorded for this account yet.</div>}
          {data.purchases?.map((p) => {
            const request = data.refunds?.find((r) => r.purchase_id === p.id);
            const status = p.refund_status && p.refund_status !== "none"
              ? p.refund_status === "refunded" ? "Refunded" : p.refund_status
              : "Paid";
            return (
              <article key={p.id} style={{ ...panel, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <strong style={{ display: "block", fontSize: 16, color: "#173C33" }}>
                      {p.quantity} audit credit{p.quantity === 1 ? "" : "s"}
                    </strong>
                    <div style={{ fontSize: 12, color: "#60766F", marginTop: 5 }}>
                      {new Date(p.created_at).toLocaleDateString()} · {p.payment_provider || "Payment"}
                    </div>
                  </div>
                  <strong style={{ whiteSpace: "nowrap", fontSize: 17, color: "#173C33" }}>{money(p)}</strong>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
                  <span style={{ background: "#EEF5F2", color: "#276858", padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 700 }}>{status}</span>
                  {request && <span style={{ color: "#657A73", fontSize: 12 }}>Support request: {request.status}</span>}
                </div>
                <div style={{ fontSize: 11, color: "#71847C", marginTop: 12, overflowWrap: "anywhere" }}>Purchase reference: {p.id}</div>
              </article>
            );
          })}
          <p style={{ color: "#62796F", fontSize: 12, lineHeight: 1.6, marginTop: 16 }}>
            For questions about a transaction, visit <a href="/#help" style={{ color: "#176A55", fontWeight: 700 }}>Help & Support</a>.
            Refund terms are described in our <a href="/#legal-refunds" style={{ color: "#176A55" }}>Refund Policy</a>.
            Creem processes payment receipts and approved refunds.
          </p>
        </>
      )}
    </section>
  );
}
