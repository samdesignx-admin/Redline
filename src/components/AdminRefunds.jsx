import { useEffect, useState } from "react";
export default function AdminRefunds({ adminKey }) {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  async function send(action, extra = {}) {
    const response = await fetch("/api/admin-refunds", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: adminKey, action, ...extra })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Request failed");
    return result;
  }
  async function reload() {
    try { const result = await send("list"); setRequests(result.requests); setError(""); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { reload(); }, [adminKey]);
  async function review(requestId, decision) {
    try { await send("review", { requestId, decision }); await reload(); }
    catch (err) { setError(err.message); }
  }
  return <section style={{ padding: 18, marginTop: 20, border: "1px solid #ddd", borderRadius: 12 }}>
    <h2>Refund review</h2>
    <p>Approvals do not issue payments. Process approved refunds separately in Creem after verifying eligibility.</p>
    {error && <p role="alert">{error}</p>}
    <button onClick={reload}>Refresh</button>
    {requests.map(request => <article key={request.id} style={{ padding: 12, borderBottom: "1px solid #ddd" }}>
      <strong>{request.status}</strong>
      <p>{request.reason}</p>
      <small>Purchase: {request.purchase_id}</small>
      {["requested", "reviewing"].includes(request.status) && <div>
        <button onClick={() => review(request.id, "approved")}>Approve</button>
        <button onClick={() => review(request.id, "rejected")}>Reject</button>
      </div>}
    </article>)}
  </section>;
}
