CREATE TABLE "monitoring_alias_cache" (
	"days" integer PRIMARY KEY NOT NULL,
	"body" jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_alias_decisions" (
	"token_key" varchar(100) PRIMARY KEY NOT NULL,
	"body" jsonb,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_alias_history" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitoring_alias_history_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"token_key" varchar(100) NOT NULL,
	"previous" jsonb,
	"next" jsonb,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
