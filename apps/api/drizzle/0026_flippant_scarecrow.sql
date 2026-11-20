CREATE TABLE "monitoring_briefing_revisions" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_briefing_revisions_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"day" date NOT NULL,
	"revision" integer NOT NULL,
	"report" jsonb NOT NULL,
	"digest" char(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_monitoring_briefing_revision" ON "monitoring_briefing_revisions" USING btree ("day","revision");