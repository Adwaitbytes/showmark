CREATE TABLE "campaign_events" (
	"campaign_id" bigint NOT NULL,
	"event_id" bigint NOT NULL,
	"approved" boolean NOT NULL,
	CONSTRAINT "campaign_events_campaign_id_event_id_pk" PRIMARY KEY("campaign_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" bigint PRIMARY KEY NOT NULL,
	"sponsor" text NOT NULL,
	"token" text NOT NULL,
	"pricing" smallint NOT NULL,
	"amount_per_presence" numeric NOT NULL,
	"attendee_share_bps" integer NOT NULL,
	"min_proof_mode" smallint NOT NULL,
	"require_qie_id" boolean NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"fee_bps" integer NOT NULL,
	"name" text NOT NULL,
	"sponsor_name" text NOT NULL,
	"description" text NOT NULL,
	"url" text,
	"team_funded" boolean NOT NULL,
	"created_block" bigint NOT NULL,
	"created_tx" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "door_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"submitted_tx" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY NOT NULL,
	"organizer" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"checked_in" integer DEFAULT 0 NOT NULL,
	"max_pass_age" integer NOT NULL,
	"series_id" bigint NOT NULL,
	"series_index" integer NOT NULL,
	"name" text NOT NULL,
	"venue" text NOT NULL,
	"city" text NOT NULL,
	"description" text NOT NULL,
	"url" text,
	"created_block" bigint NOT NULL,
	"created_tx" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fundings" (
	"campaign_id" bigint NOT NULL,
	"from_addr" text NOT NULL,
	"amount" numeric NOT NULL,
	"block" bigint NOT NULL,
	"tx" text NOT NULL,
	"log_index" integer NOT NULL,
	CONSTRAINT "fundings_tx_log_index_pk" PRIMARY KEY("tx","log_index")
);
--> statement-breakpoint
CREATE TABLE "links" (
	"pass" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"block" bigint NOT NULL,
	"tx" text NOT NULL,
	CONSTRAINT "links_wallet_unique" UNIQUE("wallet")
);
--> statement-breakpoint
CREATE TABLE "presences" (
	"event_id" bigint NOT NULL,
	"attendee" text NOT NULL,
	"mode" smallint NOT NULL,
	"door_key" text NOT NULL,
	"door_time" timestamp with time zone NOT NULL,
	"streak" integer NOT NULL,
	"block" bigint NOT NULL,
	"tx" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "presences_event_id_attendee_pk" PRIMARY KEY("event_id","attendee")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"address" text PRIMARY KEY NOT NULL,
	"qie_name" text,
	"first_seen_block" bigint NOT NULL,
	"first_seen_via_showmark" boolean,
	"holds_qie_id" boolean,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"campaign_id" bigint NOT NULL,
	"sponsor" text NOT NULL,
	"amount" numeric NOT NULL,
	"block" bigint NOT NULL,
	"tx" text NOT NULL,
	"log_index" integer NOT NULL,
	CONSTRAINT "refunds_tx_log_index_pk" PRIMARY KEY("tx","log_index")
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" bigint PRIMARY KEY NOT NULL,
	"organizer" text NOT NULL,
	"name" text NOT NULL,
	"created_block" bigint NOT NULL,
	"created_tx" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_skips" (
	"campaign_id" bigint NOT NULL,
	"event_id" bigint NOT NULL,
	"attendee" text NOT NULL,
	"status" smallint NOT NULL,
	"block" bigint NOT NULL,
	"tx" text NOT NULL,
	CONSTRAINT "settlement_skips_campaign_id_event_id_attendee_pk" PRIMARY KEY("campaign_id","event_id","attendee")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"campaign_id" bigint NOT NULL,
	"event_id" bigint NOT NULL,
	"attendee" text NOT NULL,
	"organizer" text NOT NULL,
	"gross" numeric NOT NULL,
	"to_attendee" numeric NOT NULL,
	"to_organizer" numeric NOT NULL,
	"fee" numeric NOT NULL,
	"price" numeric NOT NULL,
	"block" bigint NOT NULL,
	"tx" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "settlements_campaign_id_event_id_attendee_pk" PRIMARY KEY("campaign_id","event_id","attendee")
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"last_block" bigint NOT NULL,
	CONSTRAINT "sync_state_chain_id_contract_pk" PRIMARY KEY("chain_id","contract")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"hash" text PRIMARY KEY NOT NULL,
	"block" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"token" text NOT NULL,
	"account" text NOT NULL,
	"to_addr" text NOT NULL,
	"amount" numeric NOT NULL,
	"block" bigint NOT NULL,
	"tx" text NOT NULL,
	"log_index" integer NOT NULL,
	CONSTRAINT "withdrawals_tx_log_index_pk" PRIMARY KEY("tx","log_index")
);
--> statement-breakpoint
CREATE INDEX "campaign_events_event_idx" ON "campaign_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "campaigns_sponsor_idx" ON "campaigns" USING btree ("sponsor");--> statement-breakpoint
CREATE INDEX "door_queue_event_idx" ON "door_queue" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_organizer_idx" ON "events" USING btree ("organizer");--> statement-breakpoint
CREATE INDEX "events_ends_at_idx" ON "events" USING btree ("ends_at");--> statement-breakpoint
CREATE INDEX "fundings_campaign_idx" ON "fundings" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "presences_attendee_idx" ON "presences" USING btree ("attendee");--> statement-breakpoint
CREATE INDEX "presences_at_idx" ON "presences" USING btree ("at");--> statement-breakpoint
CREATE INDEX "refunds_campaign_idx" ON "refunds" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "settlements_attendee_idx" ON "settlements" USING btree ("attendee");--> statement-breakpoint
CREATE INDEX "settlements_event_idx" ON "settlements" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "transactions_at_idx" ON "transactions" USING btree ("at");--> statement-breakpoint
CREATE INDEX "withdrawals_account_idx" ON "withdrawals" USING btree ("account");