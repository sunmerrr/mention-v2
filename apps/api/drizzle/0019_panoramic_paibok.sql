CREATE TABLE "migration_native_records" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "migration_native_records_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"snapshot_pk" integer NOT NULL,
	"key" varchar(150) NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"digest" char(64) NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "migration_native_snapshots" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "migration_native_snapshots_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"counts" jsonb NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "migration_native_snapshots_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "migration_native_records" ADD CONSTRAINT "migration_native_records_snapshot_pk_migration_native_snapshots_pk_fk" FOREIGN KEY ("snapshot_pk") REFERENCES "public"."migration_native_snapshots"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_migration_native_record" ON "migration_native_records" USING btree ("snapshot_pk","key");--> statement-breakpoint
CREATE INDEX "idx_migration_native_table" ON "migration_native_records" USING btree ("snapshot_pk","table_name");