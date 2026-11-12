CREATE TABLE "monitoring_conversations" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_conversations_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"id" char(8) NOT NULL,
	"source_id" varchar(100) NOT NULL,
	"generation_pk" integer NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"day" date NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_conversations_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "monitoring_generations" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_generations_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"metadata" jsonb NOT NULL,
	"digest" char(64) NOT NULL,
	"source_captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_labels" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_labels_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_pk" integer NOT NULL,
	"target" varchar(100) NOT NULL,
	"label" varchar(20) NOT NULL,
	"review_state" varchar(20) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_projection_state" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_projection_state_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(40) NOT NULL,
	"generation_pk" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_projection_state_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "monitoring_summaries" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_summaries_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"generation_pk" integer NOT NULL,
	"day" varchar(10) NOT NULL,
	"target" varchar(100) NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_error_logs" (
	"pk" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_error_logs_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" varchar(80) NOT NULL,
	"kind" varchar(100) NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_conversations" ADD CONSTRAINT "monitoring_conversations_generation_pk_monitoring_generations_pk_fk" FOREIGN KEY ("generation_pk") REFERENCES "public"."monitoring_generations"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_labels" ADD CONSTRAINT "monitoring_labels_conversation_pk_monitoring_conversations_pk_fk" FOREIGN KEY ("conversation_pk") REFERENCES "public"."monitoring_conversations"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_projection_state" ADD CONSTRAINT "monitoring_projection_state_generation_pk_monitoring_generations_pk_fk" FOREIGN KEY ("generation_pk") REFERENCES "public"."monitoring_generations"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_summaries" ADD CONSTRAINT "monitoring_summaries_generation_pk_monitoring_generations_pk_fk" FOREIGN KEY ("generation_pk") REFERENCES "public"."monitoring_generations"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_monitoring_conversation_source" ON "monitoring_conversations" USING btree ("generation_pk","source_id");--> statement-breakpoint
CREATE INDEX "idx_monitoring_conversations_order" ON "monitoring_conversations" USING btree ("generation_pk","occurred_at","source_id");--> statement-breakpoint
CREATE INDEX "idx_monitoring_conversations_day" ON "monitoring_conversations" USING btree ("generation_pk","day","occurred_at","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_monitoring_labels_target" ON "monitoring_labels" USING btree ("conversation_pk","target");--> statement-breakpoint
CREATE INDEX "idx_monitoring_labels_scope" ON "monitoring_labels" USING btree ("target","label","review_state","conversation_pk");--> statement-breakpoint
CREATE INDEX "idx_projection_state_generation" ON "monitoring_projection_state" USING btree ("generation_pk");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_monitoring_summary_scope" ON "monitoring_summaries" USING btree ("generation_pk","day","target");