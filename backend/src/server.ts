import "./config";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import logger from "./utils/logger";
import leadsRouter from "./routes/leads";
import campaignsRouter from "./routes/campaigns";
import generateRouter from "./routes/generate";
import sendRouter from "./routes/send";
import gmailRouter from "./routes/gmail";
import smtpRouter from "./routes/smtp";
import statsRouter from "./routes/stats";
import auditRouter from "./routes/audit";
import billingRouter from "./routes/billing";
import webhooksRouter from "./routes/webhooks";
import unsubscribeRouter from "./routes/unsubscribe";
import { apiLimiter, sendEmailLimiter, generateLimiter } from "./middleware/rateLimit";
import { sanitizeBody, validateCampaignId } from "./middleware/validate";
import { startEmailQueue, stopEmailQueue } from "./jobs/emailQueue";
import { startCsvDripFeed, stopCsvDripFeed } from "./jobs/csvDripFeed";
import { getDodoEnvironment } from "./services/dodo";

const app = express();
const PORT = process.env.PORT || 5000;

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow cross-origin resources (images, fonts)
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));

// HTTPS enforcement — redirect HTTP to HTTPS in production
// Reverse proxies (Vercel, Railway, Render) set x-forwarded-proto
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] === "http") {
      const httpsUrl = `https://${req.headers.host}${req.url}`;
      return res.redirect(301, httpsUrl);
    }
    next();
  });
}

// Health check — before CORS so uptime monitors work without Origin header
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Public unsubscribe endpoint — before CORS/auth/rate-limit. Recipients (GET) and
// mailbox providers' one-click button (POST, RFC 8058) hit this directly with no
// Origin header. Protected by an HMAC-signed token in the URL.
app.use("/api/unsubscribe", unsubscribeRouter);

// Gmail OAuth callback — Google redirects the browser here (GET) with no Origin
// header. Must be BEFORE CORS so it isn't rejected in production.
// Protected by HMAC-signed state parameter.
app.get("/api/gmail/callback", (req, res, next) => {
  req.url = "/callback";
  gmailRouter(req, res, next);
});

// Dodo Payments billing webhooks — called server-to-server with NO Origin header, so
// this MUST be registered BEFORE the CORS middleware (which rejects no-Origin requests
// in production). Uses its own JSON parser that captures the raw body for Standard
// Webhooks signature verification. No CORS / auth / rate-limit needed.
app.use(
  "/api/webhooks/dodo",
  express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); } }),
  webhooksRouter
);

// Middleware
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin ONLY in development (for curl/Postman)
    // In production, no-origin requests are blocked to prevent CSRF-like bypasses
    // EXCEPTION: handled below for OAuth callbacks and webhook paths
    if (!origin) {
      if (process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      // In production, reject no-origin requests (server-side scripts, etc.)
      return callback(new Error("Origin header required"));
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use(express.json({
  limit: "1mb",
  verify: (req: any, _res, buf) => {
    // Store raw body for webhook signature verification
    req.rawBody = buf.toString();
  },
}));
app.use(sanitizeBody);
app.use(apiLimiter);

// Routes
app.use("/api/leads", leadsRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/generate", generateLimiter, validateCampaignId, generateRouter);
app.use("/api/send", sendEmailLimiter, validateCampaignId, sendRouter);
app.use("/api/gmail", gmailRouter);
app.use("/api/smtp", smtpRouter);
app.use("/api/stats", statsRouter);
app.use("/api/audit", auditRouter);
app.use("/api/billing", billingRouter);

// (Dodo Payments webhook is mounted above, before CORS — see top of middleware setup.)

// Catch-all error handler — MUST be registered after all routes. Synchronous
// throws in route handlers, explicit next(err) calls, and rejected middleware
// (e.g. CORS) land here instead of leaking a stack trace or crashing the process.
// (Sentry's Express error handler will be inserted just before this at deploy.)
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error(
    { err: err.stack || err.message, path: req.path, method: req.method },
    "Unhandled route error"
  );
  // If the response already started streaming, defer to Express's default handler.
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  // Log the Dodo mode at boot: a live_mode deploy whose account isn't yet approved for
  // live payments fails every checkout, and that's invisible without this line.
  logger.info(
    { port: PORT, nodeEnv: process.env.NODE_ENV, dodoEnvironment: getDodoEnvironment() },
    "Backend server running"
  );
  // Start background email queue processor
  try {
    startEmailQueue();
  } catch (err) {
    logger.error({ err }, "Failed to start email queue");
  }
  // Start CSV drip-feed processor
  try {
    startCsvDripFeed();
  } catch (err) {
    logger.error({ err }, "Failed to start CSV drip-feed");
  }
});

// Graceful shutdown — stop background jobs and close server on termination signals
function gracefulShutdown(signal: string, exitCode = 0) {
  logger.info({ signal }, "Shutdown signal received, closing gracefully...");
  stopEmailQueue();
  stopCsvDripFeed();
  server.close(() => {
    logger.info("Server closed. Exiting.");
    process.exit(exitCode);
  });
  // Force exit if graceful close takes too long (10 seconds)
  setTimeout(() => {
    logger.warn("Graceful shutdown timed out, forcing exit.");
    process.exit(exitCode || 1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Global safety nets for async errors that escape try/catch. Without these an
// unhandled rejection (Node ≥15 default) or a thrown async error terminates the
// process with no structured log — taking the email queue and CSV drip-feed down
// silently. (Sentry capture hooks into both at deploy.)
process.on("unhandledRejection", (reason) => {
  // Log and keep running: one stray promise rejection shouldn't tear down the
  // whole live send pipeline.
  logger.error(
    { reason: reason instanceof Error ? (reason.stack || reason.message) : reason },
    "Unhandled promise rejection"
  );
});

process.on("uncaughtException", (err) => {
  // An uncaught exception leaves the process in an undefined state — log it, then
  // shut down gracefully so the platform restarts us clean. exit(1) ensures
  // Railway's restart-on-failure policy fires.
  logger.fatal({ err: err.stack || err.message }, "Uncaught exception — shutting down");
  gracefulShutdown("uncaughtException", 1);
});

export default app;
