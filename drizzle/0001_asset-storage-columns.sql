-- Phase 2, step 1: add the storage-metadata columns (legacy "data" kept).
-- Hand-adjusted for idempotency (IF NOT EXISTS / duplicate-safe DO blocks)
-- so scripts/migrate-assets-to-storage.mjs can apply this file directly on
-- a legacy database before moving the bytes — drizzle-kit migrate runs all
-- pending migrations in ONE transaction, so the guarded 0002 drop cannot be
-- reached on a legacy DB until the data has been moved using these columns.
DO $$ BEGIN
  CREATE TYPE "public"."asset_kind" AS ENUM('photo', 'model-source', 'model-high', 'model-low', 'model-usdz', 'poster', 'logo', 'cover', 'qr-print');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "business_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "kind" "asset_kind" DEFAULT 'photo' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "storage_key" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "bytes" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "width" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "height" integer;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "sha256" text;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "assets" ADD CONSTRAINT "assets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "assets" ADD CONSTRAINT "assets_storage_key_unique" UNIQUE("storage_key");
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;
