CREATE TABLE "forum_review_history" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forum_review_history_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" varchar(19) NOT NULL,
	"target_id" varchar(64) NOT NULL,
	"request_id" uuid NOT NULL,
	"previous" jsonb NOT NULL,
	"next" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_review_history_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "forum_review_receipts" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forum_review_receipts_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"request_id" uuid NOT NULL,
	"payload_hash" char(64) NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forum_review_receipts_request_id_unique" UNIQUE("request_id")
);
