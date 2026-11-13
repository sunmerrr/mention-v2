CREATE TABLE "evidence_aliases" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evidence_aliases_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alias" varchar(100) NOT NULL,
	"conversation_pk" integer NOT NULL,
	CONSTRAINT "evidence_aliases_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
CREATE TABLE "native_evidence_references" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "native_evidence_references_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"conversation_pk" integer NOT NULL,
	"room_id" varchar(19) NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "native_evidence_references_conversation_pk_unique" UNIQUE("conversation_pk")
);
--> statement-breakpoint
ALTER TABLE "evidence_aliases" ADD CONSTRAINT "evidence_aliases_conversation_pk_evidence_conversations_pk_fk" FOREIGN KEY ("conversation_pk") REFERENCES "public"."evidence_conversations"("pk") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_evidence_references" ADD CONSTRAINT "native_evidence_references_conversation_pk_evidence_conversations_pk_fk" FOREIGN KEY ("conversation_pk") REFERENCES "public"."evidence_conversations"("pk") ON DELETE no action ON UPDATE no action;