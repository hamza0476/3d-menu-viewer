CREATE TABLE "analytics_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"day" date NOT NULL,
	"metric" text NOT NULL,
	"dimension_type" text NOT NULL,
	"dimension_id" text DEFAULT '' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_events" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"qr_code_id" text,
	"table_id" text,
	"item_id" text,
	"type" text NOT NULL,
	"session_anon_id" text,
	"device_class" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"table_id" text,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "qr_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"label" text NOT NULL,
	"seats" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_events" ADD CONSTRAINT "guest_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_events" ADD CONSTRAINT "guest_events_qr_code_id_qr_codes_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_events" ADD CONSTRAINT "guest_events_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_events" ADD CONSTRAINT "guest_events_item_id_products_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_daily_key_uq" ON "analytics_daily" USING btree ("business_id","day","metric","dimension_type","dimension_id");--> statement-breakpoint
CREATE INDEX "guest_events_business_created_idx" ON "guest_events" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "guest_events_session_item_idx" ON "guest_events" USING btree ("session_anon_id","item_id","type","created_at");