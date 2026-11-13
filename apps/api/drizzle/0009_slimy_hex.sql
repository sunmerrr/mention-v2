CREATE TABLE "monitoring_assets" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_assets_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"path" varchar(500) NOT NULL,
	"mime" varchar(100) NOT NULL,
	"bytes" "bytea" NOT NULL,
	"digest" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_assets_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "monitoring_jobs" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "monitoring_jobs" ADD COLUMN "error_code" varchar(80);--> statement-breakpoint
ALTER TABLE "system_error_logs" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "system_error_logs" ADD COLUMN "error_code" varchar(80);