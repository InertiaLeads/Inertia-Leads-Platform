import dotenv from "dotenv";
import path from "path";

// Load env vars before anything else
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Validate required environment variables at startup
const REQUIRED_ENV_VARS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "OPENAI_API_KEY",
  "SERPER_API_KEY",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REDIRECT_URI",
  "FRONTEND_URL",
];

// Optional but recommended
const OPTIONAL_ENV_VARS = [
  "BACKEND_URL", // Public backend URL for unsubscribe links — falls back to GMAIL_REDIRECT_URI origin
  "PAGESPEED_API_KEY", // Google PageSpeed Insights — free 25k/day
  // Dodo Payments (billing). Product IDs come from Dodo Dashboard → Products.
  "DODO_PAYMENTS_API_KEY",
  "DODO_WEBHOOK_SECRET",
  "DODO_STARTER_PRODUCT_ID",
  "DODO_GROWTH_PRODUCT_ID",
  "DODO_AGENCY_PRODUCT_ID",
];

for (const key of OPTIONAL_ENV_VARS) {
  if (!process.env[key]) {
    console.warn(`⚠️  Optional env var missing: ${key} — feature will be disabled`);
  }
}

const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`\n❌ Missing required environment variables:\n   ${missing.join("\n   ")}\n`);
  process.exit(1);
}
