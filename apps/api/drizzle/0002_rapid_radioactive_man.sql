CREATE TABLE "collector_commands" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collector_commands_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"collector_pk" integer NOT NULL,
	"id" uuid NOT NULL,
	"action" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'queued' NOT NULL,
	"owner" varchar(100),
	"expires_at" timestamp with time zone,
	"target_version" varchar(1000),
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "collector_commands_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "collector_inbox" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collector_inbox_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"collector_pk" integer NOT NULL,
	"event_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"operation" varchar(30) NOT NULL,
	"captured_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"acknowledgement" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "collector_inbox_receipt_id_unique" UNIQUE("receipt_id")
);
--> statement-breakpoint
CREATE TABLE "collector_principals" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collector_principals_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"id" varchar(128) NOT NULL,
	"extension_id" char(32) NOT NULL,
	"token_hash" char(64) NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"discovery" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collector_principals_id_unique" UNIQUE("id"),
	CONSTRAINT "collector_principals_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "collector_state" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collector_state_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"collector_pk" integer NOT NULL,
	"key" varchar(160) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_discoveries" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forum_discoveries_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"collector_pk" integer NOT NULL,
	"native_id" varchar(19) NOT NULL,
	"source_url" varchar(600) NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forum_threads" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forum_threads_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"collector_pk" integer NOT NULL,
	"native_id" varchar(19) NOT NULL,
	"url" varchar(200) NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone,
	"latest_inbox_pk" integer,
	"matched" boolean,
	"read_error" varchar(100)
);
--> statement-breakpoint
ALTER TABLE "collector_commands" ADD CONSTRAINT "collector_commands_collector_pk_collector_principals_pk_fk" FOREIGN KEY ("collector_pk") REFERENCES "public"."collector_principals"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_inbox" ADD CONSTRAINT "collector_inbox_collector_pk_collector_principals_pk_fk" FOREIGN KEY ("collector_pk") REFERENCES "public"."collector_principals"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_state" ADD CONSTRAINT "collector_state_collector_pk_collector_principals_pk_fk" FOREIGN KEY ("collector_pk") REFERENCES "public"."collector_principals"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_discoveries" ADD CONSTRAINT "forum_discoveries_collector_pk_collector_principals_pk_fk" FOREIGN KEY ("collector_pk") REFERENCES "public"."collector_principals"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_collector_pk_collector_principals_pk_fk" FOREIGN KEY ("collector_pk") REFERENCES "public"."collector_principals"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forum_threads" ADD CONSTRAINT "forum_threads_latest_inbox_pk_collector_inbox_pk_fk" FOREIGN KEY ("latest_inbox_pk") REFERENCES "public"."collector_inbox"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_collector_commands_queue" ON "collector_commands" USING btree ("collector_pk","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_collector_event" ON "collector_inbox" USING btree ("collector_pk","event_id");--> statement-breakpoint
CREATE INDEX "idx_collector_inbox_pending" ON "collector_inbox" USING btree ("processed_at","pk");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_collector_state_key" ON "collector_state" USING btree ("collector_pk","key");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_forum_discovery" ON "forum_discoveries" USING btree ("collector_pk","native_id","source_url");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_forum_thread_collector" ON "forum_threads" USING btree ("collector_pk","native_id");--> statement-breakpoint
CREATE INDEX "idx_forum_thread_queue" ON "forum_threads" USING btree ("collector_pk","captured_at","discovered_at");