CREATE TABLE "dialogue_guide_history" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dialogue_guide_history_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19) NOT NULL,
	"previous" jsonb,
	"config" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dialogue_guide_messages" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dialogue_guide_messages_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19) NOT NULL,
	"log_id" varchar(19) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dialogue_guide_rooms" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "dialogue_guide_rooms_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19) NOT NULL,
	"config" jsonb NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dialogue_guide_rooms_room_id_unique" UNIQUE("room_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_dialogue_guide_message" ON "dialogue_guide_messages" USING btree ("room_id","log_id");--> statement-breakpoint
CREATE INDEX "idx_dialogue_guide_recent" ON "dialogue_guide_messages" USING btree ("room_id","observed_at","log_id");