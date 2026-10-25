// Creem full refunds are irreversible. Use only after an explicit admin decision.
// The feature gate is OFF by default; no production refunds are sent until enabled.
export async function issueCreemFullRefund(transactionId) {
  if (process.env.CREEM_ENABLE_API_REFUNDS !== "true")
    throw new Error("Creem API refunds are disabled.");
  if (!/^tran_[A-Za-z0-9_-]+$/.test(transactionId || ""))
    throw new Error("Invalid Creem transaction.");
  if (!process.env.CREEM_API_KEY) throw new Error("Creem API key is not configured.");
  const mode = process.env.CREEM_MODE || "test";
  if (!["test", "live"].includes(mode)) throw new Error("Creem environment is invalid.");
  const base = mode === "live" ? "https://api.creem.io" : "https://test-api.creem.io";
  // Do not retry this POST automatically: Creem refund creation has no guaranteed
  // idempotency key. An ambiguous network failure must be reconciled manually.
  const response = await fetch(base + "/v1/refunds", {
    method: "POST",
    headers: { "x-api-key": process.env.CREEM_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ transaction_id: transactionId }),
    signal: AbortSignal.timeout(12500),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Creem refused the refund request (" + response.status + "). Reconcile with Creem before retrying.");
    error.providerStatus = response.status;
    throw error;
  }
  return data?.refund || data?.data || data;
}
