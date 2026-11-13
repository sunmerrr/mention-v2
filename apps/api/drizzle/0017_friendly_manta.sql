CREATE TABLE "kakao_messages" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "kakao_messages_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19) NOT NULL,
	"log_id" varchar(19) NOT NULL,
	"order_id" numeric(19, 0) NOT NULL,
	"body" jsonb NOT NULL,
	"intake_pk" integer
);
--> statement-breakpoint
CREATE TABLE "native_room_dirty" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "native_room_dirty_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19) NOT NULL,
	"last_intake_pk" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "native_room_dirty_room_id_unique" UNIQUE("room_id")
);
--> statement-breakpoint
CREATE TABLE "native_worker_offsets" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "native_worker_offsets_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"consumer" varchar(80) NOT NULL,
	"last_pk" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "native_worker_offsets_consumer_unique" UNIQUE("consumer")
);
--> statement-breakpoint
ALTER TABLE "kakao_messages" ADD CONSTRAINT "kakao_messages_intake_pk_intake_events_pk_fk" FOREIGN KEY ("intake_pk") REFERENCES "public"."intake_events"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_kakao_message_native" ON "kakao_messages" USING btree ("room_id","log_id");--> statement-breakpoint
CREATE INDEX "idx_kakao_message_history" ON "kakao_messages" USING btree ("room_id","order_id");