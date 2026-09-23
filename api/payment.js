// One-time Stripe Checkout for UXNest audits.
// First audit is free; each additional completed audit costs $10 USD, with a 50% beta discount.
import { requireDb, readSession } from "./_lib.js";

export const maxDuration = 20;

const REGULAR_PRICE_CENTS = 1000;
const BETA_DISCOUNT_PERCENT = 50;
const PRICE_CENTS = REGULAR_PRICE_CENTS * (1 - BETA_DISCOUNT_PERCENT / 100);

async function stripeRequest(path, params) {
  if (!process.env.STRIPE_SECRET_KEY) {
    const err = new Error("Payments are not configured yet. Add STRIPE_SECRET_KEY in Vercel.");
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }

  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1",
    },
    body: new URLSearchParams(params),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Stripe request failed.");
  }
  return data;
}

async function stripeGet(path) {
  if (!process.env.STRIPE_SECRET_KEY) {
    const err = new Error("Payments are not configured yet. Add STRIPE_SECRET_KEY in Vercel.");
    err.code = "STRIPE_NOT_CONFIGURED";
    throw err;
  }
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method: "GET",
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "stripe-version": "2026-03-25.dahlia; custom_checkout_payment_form_preview=v1",
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Stripe request failed.");
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const db = requireDb(res);
  if (!db) return;

  const sess = readSession((req.body || {}).token);
  if (!sess) {
    res.status(401).json({ error: "Please log in again." });
    return;
  }

  try {
    if (req.body.action === "checkout") {
      const accountId = sess.accountId;
      const session = await stripeRequest("checkout/sessions", {
        ui_mode: "form",
        mode: "payment",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": "UXNest UX Audit — Beta 50% Off",
        "line_items[0][price_data][product_data][description]": "One complete UXNest audit.",
        "line_items[0][price_data][unit_amount]": String(PRICE_CENTS),
        "line_items[0][quantity]": "1",
        "metadata[account_id]": accountId,
        billing_address_collection: "auto",
        "phone_number_collection[enabled]": "false",
        "automatic_tax[enabled]": "false",
        submit_type: "auto",
        "name_collection[individual][enabled]": "true",
        "name_collection[business][enabled]": "true",
        "name_collection[business][optional]": "true",
        integration_identifier: "custom_embedded_web_0002",
      });

      res.status(200).json({ client_secret: session.client_secret });
      return;
    }

    if (req.body.action === "verify") {
      const sessionId = String(req.body.sessionId || "").trim();
      if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
        res.status(400).json({ error: "Invalid payment session." });
        return;
      }

      const session = await stripeGet(`checkout/sessions/${encodeURIComponent(sessionId)}`);
      if (session.payment_status !== "paid") {
        res.status(402).json({ error: "Payment has not been completed yet." });
        return;
      }
      if (session.metadata?.account_id !== sess.accountId) {
        res.status(403).json({ error: "This payment belongs to a different account." });
        return;
      }
      if (Number(session.amount_total) !== PRICE_CENTS || session.currency !== "usd") {
        res.status(400).json({ error: "Unexpected payment amount." });
        return;
      }

      const { data: existing } = await db
        .from("audit_purchases")
        .select("id")
        .eq("stripe_session_id", session.id)
        .maybeSingle();

      if (!existing) {
        const { error: insertError } = await db.from("audit_purchases").insert({
          account_id: sess.accountId,
          stripe_session_id: session.id,
          amount_cents: PRICE_CENTS,
        });

        // A simultaneous verification can hit the unique constraint. In that
        // case the other request has already granted the credit.
        if (!insertError) {
          const { data: acct } = await db
            .from("accounts")
            .select("paid_audits")
            .eq("id", sess.accountId)
            .maybeSingle();
          const paid = (acct && acct.paid_audits) || 0;
          await db.from("accounts")
            .update({ paid_audits: paid + 1 })
            .eq("id", sess.accountId);
        } else {
          const duplicate = await db.from("audit_purchases")
            .select("id")
            .eq("stripe_session_id", session.id)
            .maybeSingle();
          if (!duplicate.data) throw insertError;
        }
      }

      const { data: acct } = await db
        .from("accounts")
        .select("audits_used, paid_audits")
        .eq("id", sess.accountId)
        .maybeSingle();

      res.status(200).json({
        paid: (acct && acct.paid_audits) || 0,
        used: (acct && acct.audits_used) || 0,
        credited: true,
      });
      return;
    }

    res.status(400).json({ error: "Unknown payment action" });
  } catch (e) {
    console.error("[UXNest payment]", e);
    res.status(e?.code === "STRIPE_NOT_CONFIGURED" ? 503 : 500).json({
      error: e?.message || "Payment request failed.",
      code: e?.code || "PAYMENT_ERROR",
    });
  }
}
