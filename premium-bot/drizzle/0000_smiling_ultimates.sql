CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"telegram_user_id" integer NOT NULL,
	"username" text,
	"plan_id" text NOT NULL,
	"plan_title" text NOT NULL,
	"months" integer NOT NULL,
	"amount_label" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"telegram_user_id" integer NOT NULL,
	"username" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
