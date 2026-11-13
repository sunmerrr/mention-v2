CREATE TABLE "intake_wire_snapshots" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "intake_wire_snapshots_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"owner_instance" varchar(100) NOT NULL,
	"identity" char(64) NOT NULL,
	"room_id" varchar(30) NOT NULL,
	"log_id" varchar(30) NOT NULL,
	"wire" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_intake_wire_snapshot" ON "intake_wire_snapshots" USING btree ("owner_instance","identity");--> statement-breakpoint
CREATE INDEX "idx_intake_wire_native_id" ON "intake_wire_snapshots" USING btree ("room_id","log_id");