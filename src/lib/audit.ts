import { headers } from "next/headers";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { uid } from "./auth";
import { clientIp } from "./rate-limit";

// Append-only audit trail (Phase 6 — plan §5 `audit_log`). Records the
// actions whose blast radius justifies a paper trail: team invites,
// role changes and removals, menu publish/unpublish, and platform-admin
// suspend/reinstate. Read back through the admin audit viewer
// (GET /api/admin/audit).
//
// Recording is best-effort BY DESIGN: an audit failure must never fail
// the action it describes (the same reasoning as the activity feed), so
// errors are logged, not thrown. No secrets ever go into metadata —
// invite tokens, passwords and session material are never recorded.
export type AuditEntry = {
  actorUserId: string | null;
  actorRole: string;
  businessId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    let ip: string | null = null;
    try {
      const value = clientIp({ headers: await headers() });
      ip = value === "unknown" ? null : value;
    } catch {
      ip = null; // outside a request scope (scripts) — no ip to record
    }
    await db.insert(auditLog).values({
      id: uid(),
      actorUserId: entry.actorUserId,
      actorRole: entry.actorRole,
      businessId: entry.businessId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: entry.metadata ?? null,
      ip,
    });
  } catch (e) {
    console.error("[audit] failed to record", entry.action, e);
  }
}
