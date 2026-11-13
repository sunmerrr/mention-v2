CREATE TABLE "forum_posts" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forum_posts_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" varchar(19) NOT NULL,
	"order_id" numeric(19, 0) NOT NULL,
	"detail" jsonb NOT NULL,
	"keywords" jsonb NOT NULL,
	"matched" boolean NOT NULL,
	"search_text" text NOT NULL,
	"checked_day" date NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_posts_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "forum_read_models" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forum_read_models_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(200) NOT NULL,
	"body" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_read_models_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "monitoring_jobs" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_jobs_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" varchar(100) NOT NULL,
	"revision" integer NOT NULL,
	"state" varchar(30) DEFAULT 'queued' NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monitoring_settings" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_settings_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(100) NOT NULL,
	"value" jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE INDEX "idx_forum_posts_order" ON "forum_posts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_forum_posts_day" ON "forum_posts" USING btree ("checked_day","order_id");--> statement-breakpoint
CREATE INDEX "idx_forum_posts_matched" ON "forum_posts" USING btree ("matched","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_monitoring_job_revision" ON "monitoring_jobs" USING btree ("kind","revision");--> statement-breakpoint
CREATE INDEX "idx_monitoring_jobs_pending" ON "monitoring_jobs" USING btree ("kind","state","pk");