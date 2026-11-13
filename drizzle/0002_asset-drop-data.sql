-- SAFETY GUARD (hand-added, Phase 2): never destroy legacy base64 bytes.
-- If any asset still has storage_key NULL, its bytes live ONLY in the
-- "data" column this migration drops. Abort loudly instead; the operator
-- must run `npm run assets:migrate` first (it fills storage_key/sha256 for
-- every row and verifies byte-identity), then re-run `npm run db:migrate`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "assets" WHERE "storage_key" IS NULL) THEN
    RAISE EXCEPTION 'Phase 2: unmigrated legacy assets exist. Run `npm run assets:migrate` before applying this migration.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "storage_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "bytes" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "sha256" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" DROP COLUMN "data";