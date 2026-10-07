CREATE TABLE "apikey_secret" (
	"apikey_id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apikey_secret" ADD CONSTRAINT "apikey_secret_apikey_id_apikey_id_fk" FOREIGN KEY ("apikey_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;