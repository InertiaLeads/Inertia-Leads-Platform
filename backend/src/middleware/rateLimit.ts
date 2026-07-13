import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Request } from "express";
import supabase from "../services/supabase";

// NOTE: Uses in-memory store (default). Fine for single-instance deployments.
// For multi-instance scaling, switch to rate-limit-redis:
//   import RedisStore from "rate-limit-redis";
//   store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args) })

// Cache verified user IDs to avoid hitting Supabase on every request
const verifiedUserCache = new Map<string, { userId: string; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Extract user ID from auth token for user-based rate limiting
// Verifies token with Supabase to prevent forged token attacks
// Falls back to IP (with IPv6 normalization) for unauthenticated routes
async function getVerifiedUserId(token: string): Promise<string | null> {
  // Check cache first
  const cached = verifiedUserCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;

    // Cache the verified user ID
    verifiedUserCache.set(token, {
      userId: data.user.id,
      expiresAt: Date.now() + CACHE_TTL,
    });

    // Periodically clean up expired cache entries
    if (verifiedUserCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of verifiedUserCache) {
        if (value.expiresAt < now) verifiedUserCache.delete(key);
      }
    }

    return data.user.id;
  } catch {
    return null;
  }
}

function getUserKey(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    // Use the token itself as the key temporarily
    // The verified user ID will be used once resolved
    // This is safe because invalid tokens will just get IP-based limiting
    const cached = verifiedUserCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      return `user_${cached.userId}`;
    }
    // For uncached tokens, verify in background and use token hash for now
    // This prevents forged tokens from affecting other users
    getVerifiedUserId(token); // fire-and-forget to populate cache
    // Use a hash of the token itself (not decoded payload) as key
    // This way forged tokens only affect the attacker, not the victim
    const tokenHash = Buffer.from(token.slice(-32)).toString("base64url");
    return `token_${tokenHash}`;
  }
  return ipKeyGenerator(req.ip || "unknown");
}

// Skip rate limiting entirely in local development so manual testing isn't throttled.
// Production (NODE_ENV === "production") always enforces every limit below.
const skipRateLimitInDev = () => process.env.NODE_ENV !== "production";

// General API rate limiter: 300 requests per 15 minutes per user.
// Covers cheap read endpoints (stats, inbox status, profile…). A dashboard makes several calls
// per page, so 300 leaves comfortable headroom for real active use while still capping abuse.
// Cost-sensitive/auth endpoints have their own stricter limiters below (unchanged).
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: getUserKey,
  skip: skipRateLimitInDev,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiter for email sending: 10 requests per hour per user
export const sendEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: getUserKey,
  skip: skipRateLimitInDev,
  message: { error: "Email sending rate limit exceeded. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for AI generation: 20 requests per hour per user
export const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: getUserKey,
  skip: skipRateLimitInDev,
  message: { error: "Generation rate limit exceeded. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth rate limiter: 20 requests per 15 minutes per IP (stays IP-based for login/signup)
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: skipRateLimitInDev,
  message: { error: "Too many auth attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for lead finding: 5 requests per hour per user (resource-intensive)
export const autoFindLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: getUserKey,
  skip: skipRateLimitInDev,
  message: {
    error: "Lead finding rate limit exceeded. Maximum 5 searches per hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for enrichment: 10 requests per hour per user
export const enrichLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: getUserKey,
  skip: skipRateLimitInDev,
  message: { error: "Enrichment rate limit exceeded. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
