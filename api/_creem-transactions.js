// Creem checkout -> transaction reconciliation. Server only, no API keys in browser.
const idOf = (value, prefix) => {
  const id = typeof value === "string" ? value : value && typeof value === "object" ? value.id : null;
  return typeof id === "string" && new RegExp("^" + prefix + "_[A-Za-z0-9_-]+$").test(id) ? id : null;
};

async function creemGet(path) {
  if (!process.env.CREEM_API_KEY) return null;
  const mode = process.env.CREEM_MODE || "test";
  if (mode !== "test" && mode !== "live") throw new Error("Unsupported Creem mode");
  const base = mode === "live" ? "https://api.creem.io" : "https://test-api.creem.io";
  const response = await fetch(base + path, {
    headers: { "x-api-key": process.env.CREEM_API_KEY },
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok) throw new Error("Creem transaction lookup failed (" + response.status + ")");
  return response.json();
}

export async function getCreemCheckout(checkoutId) {
  if (!idOf(checkoutId, "ch")) throw new Error("Invalid checkout identifier");
  const response = await creemGet("/v1/checkouts?checkout_id=" + encodeURIComponent(checkoutId));
  return response?.checkout || response?.data || response || null;
}

export async function getCreemTransaction(transactionId) {
  if (!idOf(transactionId, "tran")) throw new Error("Invalid transaction identifier");
  const response = await creemGet("/v1/transactions?transaction_id=" + encodeURIComponent(transactionId));
  return response?.transaction || response?.data || response || null;
}

export async function syncCreemPurchase(db, checkout) {
  const checkoutId = idOf(checkout?.id, "ch");
  if (!checkoutId || checkout.status !== "completed") return { linked: false, reason: "checkout-not-complete" };
  const orderId = idOf(checkout.order, "ord");
  let transactionId = idOf(checkout.transaction, "tran") ||
    idOf(checkout.order?.transaction, "tran") ||
    idOf(checkout.order?.transactions?.[0], "tran");

  if (!transactionId && orderId && process.env.CREEM_API_KEY) {
    try {
      const response = await creemGet("/v1/transactions/search?order_id=" + encodeURIComponent(orderId) + "&page_size=10");
      const list = response?.items || response?.data?.items || response?.transactions || [];
      const matching = list.filter(t => idOf(t.order, "ord") === orderId &&
        idOf(t.id, "tran") && ["paid", "refunded", "partially_refunded"].includes(t.status));
      if (matching.length === 1) transactionId = matching[0].id;
    } catch (error) {
      // Payment credit grant is independent of transaction enrichment. Admin can retry reconciliation.
      console.warn("[UXNest] Creem transaction lookup unavailable:", error.message);
    }
  }
  if (!orderId && !transactionId) return { linked: false, reason: "no-order-or-transaction" };
  const { data, error } = await db.rpc("record_creem_purchase_details", {
    p_checkout_id: checkoutId, p_transaction_id: transactionId, p_order_id: orderId,
  });
  if (error) throw error;
  return { linked: data === true, transactionLinked: !!transactionId, orderLinked: !!orderId };
}

export async function syncRefundTransactionFromCreem(db, transactionId) {
  const transaction = await getCreemTransaction(transactionId);
  if (!transaction || transaction.id !== transactionId) return false;
  const orderId = idOf(transaction.order, "ord");
  if (!orderId) return false;
  const { data: purchase, error } = await db.from("audit_purchases")
    .select("creem_checkout_id").eq("creem_order_id", orderId).eq("payment_provider", "creem").maybeSingle();
  if (error) throw error;
  if (!purchase?.creem_checkout_id) return false;
  const { error: linkError, data } = await db.rpc("record_creem_purchase_details", {
    p_checkout_id: purchase.creem_checkout_id, p_transaction_id: transactionId, p_order_id: orderId,
  });
  if (linkError) throw linkError;
  return data === true;
}
