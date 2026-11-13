CREATE TABLE "evidence_classifications" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evidence_classifications_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_pk" integer NOT NULL,
	"source_id" varchar(100) NOT NULL,
	"target" varchar(100) NOT NULL,
	"label" varchar(20) NOT NULL,
	"review_state" varchar(20) NOT NULL,
	"day" date NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_conversations" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evidence_conversations_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" varchar(100) NOT NULL,
	"detail" jsonb NOT NULL,
	"source_digest" char(64) NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_conversations_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_history" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evidence_history_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_pk" integer NOT NULL,
	"target" varchar(100) NOT NULL,
	"request_id" uuid NOT NULL,
	"previous" jsonb NOT NULL,
	"next" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_history_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_receipts" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evidence_receipts_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" uuid NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_receipts_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
ALTER TABLE "evidence_classifications" ADD CONSTRAINT "evidence_classifications_conversation_pk_evidence_conversations_pk_fk" FOREIGN KEY ("conversation_pk") REFERENCES "public"."evidence_conversations"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_history" ADD CONSTRAINT "evidence_history_conversation_pk_evidence_conversations_pk_fk" FOREIGN KEY ("conversation_pk") REFERENCES "public"."evidence_conversations"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_evidence_target" ON "evidence_classifications" USING btree ("conversation_pk","target");--> statement-breakpoint
CREATE INDEX "idx_evidence_classification_filter" ON "evidence_classifications" USING btree ("target","label","day");--> statement-breakpoint
CREATE INDEX "idx_evidence_classification_order" ON "evidence_classifications" USING btree ("occurred_at","source_id");