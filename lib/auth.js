const crypto = require("node:crypto");
const db = require("./db");
const marketplace = require("./marketplace");

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
}

const hash = (key) => crypto.createHash("sha256").update(key).digest("hex");

function generateApiKey() {
  const raw = crypto.randomBytes(24).toString("hex");
  const key = "hc_live_" + raw;
  const prefix = key.slice(0, 12); // shown in dashboards, never the full key
  return { key, prefix, keyHash: hash(key) };
}

async function requireApiKey(req) {
  const auth = req.headers["authorization"] || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return null;
  const keyHash = hash(m[1].trim());
  const { rows } = await db.query(
    `SELECT c.id, c.email, c.stripe_customer_id, c.stripe_subscription_item_id, c.marketplace_customer_id, k.id AS api_key_id
     FROM api_keys k JOIN customers c ON c.id = k.customer_id
     WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [keyHash]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, email: r.email, apiKeyId: r.api_key_id,
    stripeCustomerId: r.stripe_customer_id, stripeSubscriptionItemId: r.stripe_subscription_item_id,
    marketplaceCustomerId: r.marketplace_customer_id,
  };
}

async function recordUsage(customer, { route, ms }) {
  await db.query(
    `INSERT INTO usage_events (customer_id, api_key_id, route, ms) VALUES ($1, $2, $3, $4)`,
    [customer.id, customer.apiKeyId, route, ms]
  );
  // Best-effort Stripe metered usage report -- never let a Stripe hiccup break the actual API response.
  if (stripe && customer.stripeSubscriptionItemId) {
    try {
      await stripe.subscriptionItems.createUsageRecord(customer.stripeSubscriptionItemId, {
        quantity: 1,
        timestamp: Math.floor(Date.now() / 1000),
        action: "increment",
      });
    } catch (e) {
      console.error("stripe usage report failed:", e.message);
    }
  }
  // Best-effort AWS Marketplace metered usage report -- no-op until a Marketplace listing exists (see MARKETPLACE.md).
  if (customer.marketplaceCustomerId) await marketplace.reportUsage(customer.marketplaceCustomerId);
}

async function createCustomer({ email, company }) {
  let stripeCustomerId = null;
  if (stripe) {
    const sc = await stripe.customers.create({ email, name: company || undefined });
    stripeCustomerId = sc.id;
  }
  const { rows } = await db.query(
    `INSERT INTO customers (email, company, stripe_customer_id) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET company = EXCLUDED.company
     RETURNING id, email, stripe_customer_id`,
    [email, company || null, stripeCustomerId]
  );
  return rows[0];
}

async function createApiKey(customerId, label) {
  const { key, prefix, keyHash } = generateApiKey();
  await db.query(
    `INSERT INTO api_keys (customer_id, key_hash, key_prefix, label) VALUES ($1, $2, $3, $4)`,
    [customerId, keyHash, prefix, label || null]
  );
  return key; // plaintext -- only ever returned here, at creation time
}

module.exports = { requireApiKey, recordUsage, createCustomer, createApiKey };
