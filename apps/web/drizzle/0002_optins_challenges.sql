CREATE TABLE "campaign_optins" (
	"campaign_id" bigint NOT NULL,
	"organizer" text NOT NULL,
	"opted_in" boolean NOT NULL,
	"block" bigint NOT NULL,
	CONSTRAINT "campaign_optins_campaign_id_organizer_pk" PRIMARY KEY("campaign_id","organizer")
);
--> statement-breakpoint
CREATE TABLE "challenges" (
	"id" bigint PRIMARY KEY NOT NULL,
	"campaign_id" bigint NOT NULL,
	"organizer" text NOT NULL,
	"sponsor" text NOT NULL,
	"claim" numeric DEFAULT 0 NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"slashed" numeric,
	"block" bigint NOT NULL,
	"tx" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "challenges_open_idx" ON "challenges" USING btree ("campaign_id","organizer");