CREATE TABLE "native_photo_assets" (
	"route" varchar(100) PRIMARY KEY NOT NULL,
	"asset_pk" integer NOT NULL,
	"message_text" text,
	"context_text" text,
	"filename" varchar(120) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "native_photo_assets" ADD CONSTRAINT "native_photo_assets_asset_pk_monitoring_assets_pk_fk" FOREIGN KEY ("asset_pk") REFERENCES "public"."monitoring_assets"("pk") ON DELETE no action ON UPDATE no action;