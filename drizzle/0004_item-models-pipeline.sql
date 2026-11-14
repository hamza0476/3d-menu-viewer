CREATE TABLE "item_models" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"business_id" text NOT NULL,
	"status" text DEFAULT 'none' NOT NULL,
	"source_asset_id" text,
	"high_asset_id" text,
	"low_asset_id" text,
	"usdz_asset_id" text,
	"poster_asset_id" text,
	"source_bytes" integer,
	"high_bytes" integer,
	"low_bytes" integer,
	"usdz_bytes" integer,
	"triangle_count" integer,
	"texture_count" integer,
	"texture_bytes" integer,
	"processor" text,
	"poster_status" text,
	"usdz_status" text,
	"error_message" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_models_item_id_unique" UNIQUE("item_id")
);
--> statement-breakpoint
CREATE TABLE "model_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"item_model_id" text NOT NULL,
	"business_id" text NOT NULL,
	"source_asset_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "item_models" ADD CONSTRAINT "item_models_item_id_products_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_models" ADD CONSTRAINT "item_models_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_models" ADD CONSTRAINT "item_models_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_models" ADD CONSTRAINT "item_models_high_asset_id_assets_id_fk" FOREIGN KEY ("high_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_models" ADD CONSTRAINT "item_models_low_asset_id_assets_id_fk" FOREIGN KEY ("low_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_models" ADD CONSTRAINT "item_models_usdz_asset_id_assets_id_fk" FOREIGN KEY ("usdz_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_models" ADD CONSTRAINT "item_models_poster_asset_id_assets_id_fk" FOREIGN KEY ("poster_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_jobs" ADD CONSTRAINT "model_jobs_item_model_id_item_models_id_fk" FOREIGN KEY ("item_model_id") REFERENCES "public"."item_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_jobs" ADD CONSTRAINT "model_jobs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_jobs" ADD CONSTRAINT "model_jobs_source_asset_id_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_models_business_idx" ON "item_models" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "model_jobs_queue_idx" ON "model_jobs" USING btree ("status","created_at");