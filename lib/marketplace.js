// Optional AWS Marketplace metered-billing integration (SaaS Flexible Consumption Pricing).
// Inactive until MARKETPLACE_PRODUCT_CODE is set -- safe no-op alongside the existing Stripe path
// in lib/auth.js. Fill in once the AWS Marketplace product listing exists (see MARKETPLACE.md).
const { MarketplaceMeteringClient, BatchMeterUsageCommand, ResolveCustomerCommand } = (() => {
  try {
    return require("@aws-sdk/client-marketplace-metering");
  } catch {
    return {}; // dependency only needed once Marketplace listing is actually wired up
  }
})();

const PRODUCT_CODE = process.env.MARKETPLACE_PRODUCT_CODE || null;
const REGION = process.env.AWS_REGION || "eu-central-1";
let client = null;
if (PRODUCT_CODE && MarketplaceMeteringClient) client = new MarketplaceMeteringClient({ region: REGION });

// Called once when a buyer lands after subscribing via the AWS Marketplace registration URL,
// with their one-time registration token in the query string (?x-amzn-marketplace-token=...).
async function resolveCustomer(registrationToken) {
  if (!client) return null;
  const res = await client.send(new ResolveCustomerCommand({ RegistrationToken: registrationToken }));
  return { customerIdentifier: res.CustomerIdentifier, productCode: res.ProductCode };
}

// Report one unit of usage for a Marketplace-originated customer. Best-effort: never throws
// into the request path, matching the Stripe usage-report pattern in lib/auth.js.
async function reportUsage(marketplaceCustomerId, dimension = "api_call") {
  if (!client || !marketplaceCustomerId) return;
  try {
    await client.send(new BatchMeterUsageCommand({
      ProductCode: PRODUCT_CODE,
      UsageRecords: [{ Timestamp: new Date(), CustomerIdentifier: marketplaceCustomerId, Dimension: dimension, Quantity: 1 }],
    }));
  } catch (e) {
    console.error("marketplace usage report failed:", e.message);
  }
}

module.exports = { resolveCustomer, reportUsage, isConfigured: () => !!client };
