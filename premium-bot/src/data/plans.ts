export type PremiumPlanId = "premium_3" | "premium_6" | "premium_12";

export type PremiumPlan = {
  id: PremiumPlanId;
  title: string;
  months: number;
  priceLabel: string;
  amountValue: number;
};

export const premiumPlans: PremiumPlan[] = [
  {
    id: "premium_3",
    title: "Telegram Premium - 3 месяца",
    months: 3,
    amountValue: 1050,
    priceLabel: "1050 RUB",
  },
  {
    id: "premium_6",
    title: "Telegram Premium - 6 месяцев",
    months: 6,
    amountValue: 1398,
    priceLabel: "1398 RUB",
  },
  {
    id: "premium_12",
    title: "Telegram Premium - 12 месяцев",
    months: 12,
    amountValue: 2538,
    priceLabel: "2538 RUB",
  },
];

export const premiumPlanIds = premiumPlans.map((plan) => plan.id);

export async function getPremiumPlans() {
  return premiumPlans;
}

export async function getPremiumPlanById(planId: string) {
  return premiumPlans.find((plan) => plan.id === planId);
}
