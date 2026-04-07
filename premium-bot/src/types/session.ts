export type BotSession = {
  lastOrderId?: string;
  awaitingReceiptOrderId?: string | undefined;
  purchaseMode?: "self" | "gift" | undefined;
  awaitingGiftRecipientUsername?: boolean | undefined;
  giftRecipientUsername?: string | undefined;
};
