CREATE TABLE "forum_retained_reviews" (
	"pk" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "forum_retained_reviews_pk_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source_id" varchar(19) NOT NULL,
	"target_id" varchar(64) NOT NULL,
	"signature" char(64) NOT NULL,
	"evaluation" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_forum_retained_review" ON "forum_retained_reviews" USING btree ("source_id","target_id");