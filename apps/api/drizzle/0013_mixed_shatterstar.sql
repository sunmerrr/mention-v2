CREATE TABLE "forum_source_evidence" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forum_source_evidence_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" varchar(19) NOT NULL,
	"raw" jsonb NOT NULL,
	"checked_at" double precision NOT NULL,
	"inbox_pk" integer,
	CONSTRAINT "forum_source_evidence_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "forum_source_evidence" ADD CONSTRAINT "forum_source_evidence_inbox_pk_collector_inbox_pk_fk" FOREIGN KEY ("inbox_pk") REFERENCES "public"."collector_inbox"("pk") ON DELETE no action ON UPDATE no action;