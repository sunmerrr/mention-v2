CREATE TABLE "evidence_legacy_audit" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evidence_legacy_audit_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"identity" char(64) NOT NULL,
	"source" varchar(100) NOT NULL,
	"request_id" varchar(100),
	"state" varchar(40),
	"body" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_legacy_audit_identity_unique" UNIQUE("identity")
);
--> statement-breakpoint
CREATE INDEX "idx_evidence_legacy_request" ON "evidence_legacy_audit" USING btree ("request_id");