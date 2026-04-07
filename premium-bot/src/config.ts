import "dotenv/config";

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  throw new Error("BOT_TOKEN is missing in .env");
}

const paymentCardNumber = process.env.PAYMENT_CARD_NUMBER;
if (!paymentCardNumber) {
  throw new Error("PAYMENT_CARD_NUMBER is missing in .env");
}

const adminContactUsername = process.env.ADMIN_CONTACT_USERNAME;
if (!adminContactUsername) {
  throw new Error("ADMIN_CONTACT_USERNAME is missing in .env");
}

export const config = {
  botToken,
  paymentCardNumber,
  adminContactUsername: adminContactUsername.startsWith("@")
    ? adminContactUsername
    : `@${adminContactUsername}`,
  adminIds: (process.env.ADMIN_IDS ?? process.env.ADMIN_ID ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number),
};
