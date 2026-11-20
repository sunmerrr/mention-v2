CREATE TABLE "native_photo_jobs" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "native_photo_jobs_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19) NOT NULL,
	"log_id" varchar(19) NOT NULL,
	"text" text NOT NULL,
	"state" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"after" timestamp with time zone DEFAULT now() NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_native_photo_job" ON "native_photo_jobs" USING btree ("room_id","log_id");--> statement-breakpoint
CREATE INDEX "idx_native_photo_jobs_ready" ON "native_photo_jobs" USING btree ("state","after");