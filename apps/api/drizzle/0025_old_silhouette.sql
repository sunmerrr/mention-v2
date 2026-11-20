CREATE TABLE "monitoring_timeline_messages" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_timeline_messages_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19) NOT NULL,
	"log_id" varchar(19) NOT NULL,
	"day" date NOT NULL,
	"sort_at" bigint NOT NULL,
	"hits" jsonb NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_timeline_state" (
	"key" varchar(30) PRIMARY KEY NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"settings_digest" char(64) NOT NULL,
	"last_intake_pk" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_timeline_message" ON "monitoring_timeline_messages" USING btree ("room_id","log_id");--> statement-breakpoint
CREATE INDEX "idx_timeline_day_cursor" ON "monitoring_timeline_messages" USING btree ("day","sort_at","pk");--> statement-breakpoint
CREATE INDEX "idx_timeline_cursor" ON "monitoring_timeline_messages" USING btree ("sort_at","pk");