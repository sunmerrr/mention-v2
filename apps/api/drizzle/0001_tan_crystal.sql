CREATE TABLE "intake_events" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "intake_events_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" varchar(30) NOT NULL,
	"owner_instance" varchar(100) NOT NULL,
	"identity" char(64) NOT NULL,
	"room_id" varchar(30),
	"log_id" varchar(30),
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_gaps" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "intake_gaps_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"consumer" varchar(80) NOT NULL,
	"owner_instance" varchar(100) NOT NULL,
	"cursor" varchar(300) NOT NULL,
	"reason" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_offsets" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "intake_offsets_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"consumer" varchar(80) NOT NULL,
	"owner_instance" varchar(100) NOT NULL,
	"cursor" varchar(300) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_offsets_consumer_unique" UNIQUE("consumer")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_intake_native_event" ON "intake_events" USING btree ("source","owner_instance","identity");--> statement-breakpoint
CREATE INDEX "idx_intake_room_log" ON "intake_events" USING btree ("room_id","log_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_intake_gap_cursor" ON "intake_gaps" USING btree ("consumer","owner_instance","cursor","reason");