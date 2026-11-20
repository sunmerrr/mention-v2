CREATE TABLE "monitoring_context_edits" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_context_edits_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"episode_id" varchar(100) NOT NULL,
	"log_id" varchar(19) NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_context_history" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_context_history_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"episode_id" varchar(100) NOT NULL,
	"log_id" varchar(19) NOT NULL,
	"previous" jsonb NOT NULL,
	"next" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_episode_edits" (
	"episode_id" varchar(100) PRIMARY KEY NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_context_edit" ON "monitoring_context_edits" USING btree ("episode_id","log_id");