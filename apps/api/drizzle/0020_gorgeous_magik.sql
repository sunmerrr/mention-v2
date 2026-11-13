CREATE TABLE "monitoring_room_gaps" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_room_gaps_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19),
	"source_key" varchar(150) NOT NULL,
	"body" jsonb NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	CONSTRAINT "monitoring_room_gaps_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "monitoring_room_policy_history" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_room_policy_history_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19) NOT NULL,
	"previous" boolean NOT NULL,
	"excluded" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_rooms" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_rooms_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"room_id" varchar(19) NOT NULL,
	"body" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"excluded" boolean NOT NULL,
	"joined" boolean NOT NULL,
	"snapshot_id" uuid NOT NULL,
	CONSTRAINT "monitoring_rooms_room_id_unique" UNIQUE("room_id")
);
