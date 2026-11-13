CREATE TABLE "evidence_metadata" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evidence_metadata_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(40) NOT NULL,
	"body" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_metadata_key_unique" UNIQUE("key")
);
