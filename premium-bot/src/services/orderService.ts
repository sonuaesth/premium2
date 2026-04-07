import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { orders } from "../db/schema";
import { getPremiumPlanById } from "../data/plans";

export type OrderStatus =
  | "awaiting_receipt"
  | "pending_review"
  | "approved"
  | "fulfilled"
  | "declined"
  | "fulfillment_failed";

export async function createOrder(params: {
  telegramUserId: number;
  username?: string;
  planId: string;
}) {
  const plan = await getPremiumPlanById(params.planId);
  if (!plan) throw new Error("Тариф не найден");

  const id = `ORD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const [order] = await db
    .insert(orders)
    .values({
      id,
      telegramUserId: params.telegramUserId,
      username: params.username,
      planId: plan.id,
      planTitle: plan.title,
      months: plan.months,
      amountLabel: plan.priceLabel,
      status: "awaiting_receipt",
    })
    .returning();

  if (!order) {
    throw new Error("Не удалось создать заказ");
  }

  return order;
}

export async function getOrderById(orderId: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return order;
}

export async function getUserOrders(telegramUserId: number) {
  return db
    .select()
    .from(orders)
    .where(eq(orders.telegramUserId, telegramUserId))
    .orderBy(desc(orders.createdAt));
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
) {
  const [order] = await db
    .update(orders)
    .set({ status, updatedAt: new Date() })
    .where(eq(orders.id, orderId))
    .returning();
  return order;
}
