// Server-side data helpers for tables & QR codes (Phase 3 — fixes G2).
// Every query is scoped by business id; route handlers obtain that id from
// requireMembership() (the Phase 1 tenancy seam), never from the request.
import { db } from "@/db";
import { businesses, qrCodes, tables } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { uid } from "./auth";
import { generateQrCode } from "./qr";

export type QrRow = typeof qrCodes.$inferSelect;
export type TableRow = typeof tables.$inferSelect;

async function insertQr(values: Omit<QrRow, "id" | "code" | "design" | "active" | "createdAt"> & { design?: QrRow["design"] }): Promise<QrRow> {
  // Code collisions are astronomically unlikely (31^12) but the unique
  // constraint is the real guard — retry with a fresh code if it ever fires.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db.insert(qrCodes).values({ id: uid(), code: generateQrCode(), design: {}, ...values }).returning();
      return row;
    } catch (e) {
      if (attempt === 4 || !String((e as Error)?.message ?? e).includes("23505")) throw e;
    }
  }
  throw new Error("Could not allocate a QR code");
}

// The master QR (tableId NULL) is created lazily the first time the owner
// opens the QR section, so every restaurant — including ones created before
// Phase 3 — has exactly one.
export async function ensureMasterQr(businessId: string): Promise<QrRow> {
  const [existing] = await db.select().from(qrCodes).where(and(eq(qrCodes.businessId, businessId), isNull(qrCodes.tableId)));
  if (existing) return existing;
  return insertQr({ businessId, tableId: null, label: "Master QR" });
}

export async function createTableQr(businessId: string, table: TableRow): Promise<QrRow> {
  return insertQr({ businessId, tableId: table.id, label: table.label });
}

export async function listTablesWithQr(businessId: string): Promise<{ master: QrRow; tables: (TableRow & { qr: QrRow | null })[] }> {
  const master = await ensureMasterQr(businessId);
  const [tableRows, qrRows] = await Promise.all([
    db.select().from(tables).where(eq(tables.businessId, businessId)).orderBy(asc(tables.createdAt)),
    db.select().from(qrCodes).where(eq(qrCodes.businessId, businessId)),
  ]);
  const byTable = new Map(qrRows.filter((q) => q.tableId).map((q) => [q.tableId as string, q]));
  return { master, tables: tableRows.map((t) => ({ ...t, qr: byTable.get(t.id) ?? null })) };
}

// Resolve a printed code to its live target. Returns null when the code is
// unknown, deactivated, or the restaurant is not currently public — the
// resolver route turns all of those into the same 404 so codes cannot be
// probed for which case applies.
export async function resolveQr(code: string): Promise<{ qr: QrRow; business: typeof businesses.$inferSelect; table: TableRow | null } | null> {
  const [qr] = await db.select().from(qrCodes).where(eq(qrCodes.code, code));
  if (!qr || !qr.active) return null;
  const [business] = await db.select().from(businesses).where(and(eq(businesses.id, qr.businessId), eq(businesses.published, true), eq(businesses.suspended, false)));
  if (!business) return null;
  let table: TableRow | null = null;
  if (qr.tableId) {
    const [t] = await db.select().from(tables).where(eq(tables.id, qr.tableId));
    if (t && !t.active) return null;
    table = t ?? null;
  }
  return { qr, business, table };
}
