CREATE TABLE "monitoring_campaign_links" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_campaign_links_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"campaign_id" char(32) NOT NULL,
	"log_id" varchar(19) NOT NULL,
	"at" bigint NOT NULL,
	"role" varchar(10) NOT NULL,
	"relation" varchar(24) NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_campaigns" (
	"id" char(32) PRIMARY KEY NOT NULL,
	"request_id" varchar(128) NOT NULL,
	"room_id" varchar(19) NOT NULL,
	"anchor_at" bigint NOT NULL,
	"ends_at" bigint NOT NULL,
	"anchor_log_id" varchar(19),
	"title" varchar(140) NOT NULL,
	"seed" text NOT NULL,
	"fingerprint" char(64) NOT NULL,
	"receipt_hash" char(64),
	"coverage" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_campaigns_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "monitoring_campaign_links" ADD CONSTRAINT "monitoring_campaign_links_campaign_id_monitoring_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."monitoring_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_campaign_link" ON "monitoring_campaign_links" USING btree ("campaign_id","log_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_link_date" ON "monitoring_campaign_links" USING btree ("campaign_id","at");--> statement-breakpoint
CREATE INDEX "idx_monitoring_campaign_date" ON "monitoring_campaigns" USING btree ("anchor_at","id");