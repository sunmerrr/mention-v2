CREATE TABLE "monitoring_bookmark_history" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_bookmark_history_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bookmark_pk" integer NOT NULL,
	"previous" jsonb,
	"next" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_bookmarks" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_bookmarks_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" varchar(100) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"id" varchar(100) NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"body" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_bookmarks_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "native_episode_references" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "native_episode_references_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" varchar(100) NOT NULL,
	"conversation_pk" integer NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "native_episode_references_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "monitoring_bookmark_history" ADD CONSTRAINT "monitoring_bookmark_history_bookmark_pk_monitoring_bookmarks_pk_fk" FOREIGN KEY ("bookmark_pk") REFERENCES "public"."monitoring_bookmarks"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_episode_references" ADD CONSTRAINT "native_episode_references_conversation_pk_evidence_conversations_pk_fk" FOREIGN KEY ("conversation_pk") REFERENCES "public"."evidence_conversations"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_monitoring_bookmark_source" ON "monitoring_bookmarks" USING btree ("kind","source_id");--> statement-breakpoint
CREATE INDEX "idx_monitoring_bookmark_page" ON "monitoring_bookmarks" USING btree ("archived","updated_at","id");