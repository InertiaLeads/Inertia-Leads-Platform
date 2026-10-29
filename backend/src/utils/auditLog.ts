import { Request } from "express";
import supabase from "../services/supabase";
import logger from "./logger";

export type AuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.failed"
  | "gmail.connect"
  | "gmail.disconnect"
  | "smtp.connect"
  | "smtp.disconnect"
  | "campaign.create"
  | "campaign.update"
  | "campaign.delete"
  | "leads.import"
  | "leads.delete"
  | "leads.find"
  | "email.send"
  | "email.generate"
  | "settings.update"
  | "plan.change"
  | "imap.connect"
  | "imap.disconnect"
  | "inbox.reply"
  | "inbox.classify";

interface AuditLogEntry {
  userId?: string;
  action: AuditAction;
  resource?: string;
  resourceId?: string;
  req?: Request;
  metadata?: Record<string, unknown>;
}

export async function auditLog({ userId, action, resource, resourceId, req, metadata }: AuditLogEntry): Promise<void> {
  try {
    const ipAddress = req?.ip || req?.headers["x-forwarded-for"]?.toString() || undefined;
    const userAgent = req?.headers["user-agent"] || undefined;

    await supabase.from("audit_logs").insert({
      user_id: userId || null,
      action,
      resource: resource || null,
      resource_id: resourceId || null,
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
      metadata: metadata || {},
    });
  } catch (err) {
    // Never let audit logging break the main flow
    logger.error({ err, action, userId }, "Failed to write audit log");
  }
}
