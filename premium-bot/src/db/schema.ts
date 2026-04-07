import { pgTable, text, integer, timestamp, serial } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramUserId: integer("telegram_user_id").notNull().unique(),
  username: text("username"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  telegramUserId: integer("telegram_user_id").notNull(),
  username: text("username"),
  planId: text("plan_id").notNull(),
  planTitle: text("plan_title").notNull(),
  months: integer("months").notNull(),
  amountLabel: text("amount_label").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
