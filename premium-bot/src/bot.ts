import { Context, Markup, Telegraf, session } from "telegraf";
import { config } from "./config";
import { getPremiumPlans, premiumPlanIds } from "./data/plans";
import {
  createOrder,
  getOrderById,
  getUserOrders,
  type OrderStatus,
  updateOrderStatus,
} from "./services/orderService";
import { giftPremiumViaFragment } from "./services/premiumFulfillmentService";
import { BotSession } from "./types/session";

type MyContext = Context & {
  session: BotSession;
};

type ReceiptPayload =
  | { kind: "photo"; fileId: string }
  | { kind: "document"; fileId: string };

const bot = new Telegraf<MyContext>(config.botToken);

bot.use(
  session({
    defaultSession: () => ({}),
  }),
);

function isAdmin(userId?: number): boolean {
  if (!userId) {
    return false;
  }

  return config.adminIds.includes(userId);
}

function normalizeUsername(value: string) {
  return value.trim().replace(/^@+/, "");
}

function recipientChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Себе", "recipient_self"),
      Markup.button.callback("В подарок", "recipient_gift"),
    ],
  ]);
}

function mainMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Купить Telegram Premium", "open_recipient_menu")],
    [Markup.button.callback("Мой последний заказ", "my_last_order")],
  ]);
}

async function premiumMenu() {
  const plans = await getPremiumPlans();

  return Markup.inlineKeyboard([
    ...plans.map((plan) => [
      Markup.button.callback(`${plan.title} - ${plan.priceLabel}`, `buy_${plan.id}`),
    ]),
    [Markup.button.callback("Назад", "back_to_main")],
  ]);
}

function adminReviewKeyboard(orderId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Одобрить", `admin_approve_${orderId}`),
      Markup.button.callback("Отклонить", `admin_decline_${orderId}`),
    ],
  ]);
}

function orderStatusLabel(status: OrderStatus | string) {
  switch (status) {
    case "awaiting_receipt":
      return "Ожидает оплату и чек";
    case "pending_review":
      return "Ожидает проверки администратором";
    case "approved":
      return "Одобрен, выполняется отправка";
    case "fulfilled":
      return "Premium доставлен";
    case "declined":
      return "Отклонён";
    case "fulfillment_failed":
      return "Заказ одобрен, но доставка не удалась";
    default:
      return status;
  }
}

function formatOrderSummary(order: {
  id: string;
  username: string | null;
  planTitle: string;
  amountLabel: string;
  status: string;
}) {
  return [
    `Заказ: ${order.id}`,
    `Получатель: ${order.username ? `@${order.username}` : "не указан"}`,
    `Тариф: ${order.planTitle}`,
    `Сумма: ${order.amountLabel}`,
    `Статус: ${orderStatusLabel(order.status)}`,
  ].join("\n");
}

function extractReceipt(message: Context["message"]): ReceiptPayload | undefined {
  if (!message) {
    return undefined;
  }

  if ("photo" in message && Array.isArray(message.photo) && message.photo.length > 0) {
    const largestPhoto = message.photo[message.photo.length - 1];
    if (largestPhoto?.file_id) {
      return { kind: "photo", fileId: largestPhoto.file_id };
    }
  }

  if ("document" in message && message.document?.file_id) {
    return { kind: "document", fileId: message.document.file_id };
  }

  return undefined;
}

async function notifyAdminsAboutReceipt(
  order: {
    id: string;
    telegramUserId: number;
    username: string | null;
    planTitle: string;
    amountLabel: string;
    status: string;
  },
  receipt: ReceiptPayload,
) {
  const caption = [
    "Новый чек по заказу на Premium",
    `Заказ: ${order.id}`,
    `ID покупателя: ${order.telegramUserId}`,
    `Получатель: ${order.username ? `@${order.username}` : "не указан"}`,
    `Тариф: ${order.planTitle}`,
    `Сумма: ${order.amountLabel}`,
    `Статус: ${orderStatusLabel(order.status)}`,
  ].join("\n");

  await Promise.all(
    config.adminIds.map(async (adminId) => {
      try {
        const options = {
          caption,
          reply_markup: adminReviewKeyboard(order.id).reply_markup,
        };

        if (receipt.kind === "photo") {
          await bot.telegram.sendPhoto(adminId, receipt.fileId, options);
          return;
        }

        await bot.telegram.sendDocument(adminId, receipt.fileId, options);
      } catch (error) {
        console.error(`Не удалось уведомить администратора ${adminId}:`, error);
      }
    }),
  );
}

async function fulfillApprovedOrder(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new Error("Заказ не найден.");
  }

  if (!order.username) {
    throw new Error("У заказа нет Telegram username получателя для отправки подарка через Fragment.");
  }

  const giftResult = await giftPremiumViaFragment(order.username, order.months);
  const updated = await updateOrderStatus(order.id, "fulfilled");

  await bot.telegram.sendMessage(
    order.telegramUserId,
    [
      "Ваш заказ одобрен и успешно выполнен.",
      `Telegram Premium на ${order.months} мес. успешно отправлен получателю @${order.username}.`,
      giftResult.required_amount != null
        ? `Списано: ${giftResult.required_amount} TON`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return {
    order: updated ?? order,
    giftResult,
  };
}

async function handleAdminDecision(
  orderId: string,
  decision: "approve" | "decline",
) {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new Error("Заказ не найден.");
  }

  if (order.status !== "pending_review") {
    return {
      finalText: `Заказ ${order.id} уже обработан.\nТекущий статус: ${orderStatusLabel(order.status)}`,
    };
  }

  if (decision === "decline") {
    const updated = await updateOrderStatus(order.id, "declined");

    await bot.telegram.sendMessage(
      order.telegramUserId,
      [
        "Ваш чек и заказ были отклонены администратором.",
        `Заказ: ${order.id}`,
        `Получатель: ${order.username ? `@${order.username}` : "не указан"}`,
        `Тариф: ${order.planTitle}`,
        `Если возникли вопросы по оплате, напишите администратору ${config.adminContactUsername}.`,
      ].join("\n"),
    );

    return {
      finalText: [
        "Заказ отклонён",
        formatOrderSummary(updated ?? order),
        "Пользователь уведомлён.",
      ].join("\n\n"),
    };
  }

  const approvedOrder = await updateOrderStatus(order.id, "approved");

  await bot.telegram.sendMessage(
    order.telegramUserId,
    [
      "Ваш чек проверен, заказ одобрен.",
      "Отправка Telegram Premium уже выполняется.",
      `Заказ: ${order.id}`,
      `Получатель: ${order.username ? `@${order.username}` : "не указан"}`,
    ].join("\n"),
  );

  try {
    const { order: fulfilledOrder, giftResult } = await fulfillApprovedOrder(order.id);

    return {
      finalText: [
        "Заказ одобрен и выполнен",
        formatOrderSummary(fulfilledOrder),
        giftResult.required_amount != null
          ? `Оплачено: ${giftResult.required_amount} TON`
          : undefined,
        giftResult.transaction_hash
          ? `Транзакция: ${giftResult.transaction_hash}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  } catch (error) {
    await updateOrderStatus(order.id, "fulfillment_failed");

    const message = error instanceof Error ? error.message : String(error);

    await bot.telegram.sendMessage(
      order.telegramUserId,
      [
        "Ваш заказ был одобрен, но мы не смогли доставить Premium.",
        `Пожалуйста, свяжитесь с администратором ${config.adminContactUsername}.`,
      ].join("\n"),
    );

    return {
      finalText: [
        "Заказ одобрен, но выполнение завершилось ошибкой",
        formatOrderSummary(approvedOrder ?? order),
        `Причина: ${message}`,
      ].join("\n\n"),
    };
  }
}

function resetRecipientFlow(session: BotSession) {
  session.purchaseMode = undefined;
  session.awaitingGiftRecipientUsername = undefined;
  session.giftRecipientUsername = undefined;
}

async function showPremiumMenu(ctx: MyContext, text: string) {
  await ctx.reply(text, await premiumMenu());
}

bot.start(async (ctx) => {
  resetRecipientFlow(ctx.session);
  ctx.session.awaitingReceiptOrderId = undefined;

  const firstName = ctx.from?.first_name ?? "друг";

  await ctx.reply(
    [
      `Здравствуйте, ${firstName}!`,
      "",
      "Этот бот принимает заказы на Telegram Premium.",
      "Кому желаете приобрести подписку: себе или в подарок?",
    ].join("\n"),
    recipientChoiceKeyboard(),
  );
});

bot.command("menu", async (ctx) => {
  resetRecipientFlow(ctx.session);
  await ctx.reply("Главное меню:", mainMenu());
});

bot.action("open_recipient_menu", async (ctx) => {
  await ctx.answerCbQuery();
  resetRecipientFlow(ctx.session);
  await ctx.editMessageText(
    "Кому желаете приобрести подписку?",
    recipientChoiceKeyboard(),
  );
});

bot.action("recipient_self", async (ctx) => {
  await ctx.answerCbQuery();

  const username = ctx.from?.username;
  if (!username) {
    await ctx.reply(
      "Для оформления Premium себе нужен публичный username в Telegram. Укажите username в настройках Telegram и попробуйте снова.",
    );
    return;
  }

  ctx.session.purchaseMode = "self";
  ctx.session.giftRecipientUsername = username;
  ctx.session.awaitingGiftRecipientUsername = undefined;

  await ctx.editMessageText(
    [
      "Подписка будет оформлена на ваш аккаунт.",
      `Получатель: @${username}`,
      "",
      "Выберите тариф Telegram Premium:",
    ].join("\n"),
    await premiumMenu(),
  );
});

bot.action("recipient_gift", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.purchaseMode = "gift";
  ctx.session.giftRecipientUsername = undefined;
  ctx.session.awaitingGiftRecipientUsername = true;

  await ctx.editMessageText(
    [
      "Введите username получателя подарка.",
      "Можно отправить с @ или без него.",
    ].join("\n"),
  );
});

bot.action("back_to_main", async (ctx) => {
  await ctx.answerCbQuery();
  resetRecipientFlow(ctx.session);
  await ctx.editMessageText("Главное меню:", mainMenu());
});

for (const planId of premiumPlanIds) {
  bot.action(`buy_${planId}`, async (ctx) => {
    await ctx.answerCbQuery();

    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Не удалось определить пользователя Telegram.");
      return;
    }

    const recipientUsername =
      ctx.session.purchaseMode === "gift"
        ? ctx.session.giftRecipientUsername
        : ctx.from?.username;

    if (!recipientUsername) {
      await ctx.reply(
        "Сначала укажите, кому оформить подписку. Если это подарок, отправьте username получателя.",
        recipientChoiceKeyboard(),
      );
      return;
    }

    const order = await createOrder({
      telegramUserId: userId,
      username: recipientUsername,
      planId,
    });

    ctx.session.lastOrderId = order.id;
    ctx.session.awaitingReceiptOrderId = order.id;
    ctx.session.awaitingGiftRecipientUsername = undefined;

    await ctx.reply(
      [
        "Ваш заказ создан.",
        "",
        formatOrderSummary(order),
        "",
        "Оплатите заказ по карте ниже и отправьте сюда фото или файл чека.",
        `Карта для оплаты: ${config.paymentCardNumber}, банк - Mobile-Wallet, получатель - Османов Жаныбек.`,
        "",
        "После получения чека мы отправим его администратору на проверку.",
      ].join("\n"),
      Markup.inlineKeyboard([
        [Markup.button.callback("Проверить заказ", `check_order_${order.id}`)],
      ]),
    );
  });
}

bot.on(["photo", "document"], async (ctx) => {
  const orderId = ctx.session.awaitingReceiptOrderId;
  if (!orderId) {
    return;
  }

  const receipt = extractReceipt(ctx.message);
  if (!receipt) {
    return;
  }

  const order = await getOrderById(orderId);
  if (!order) {
    ctx.session.awaitingReceiptOrderId = undefined;
    await ctx.reply("Заказ для чека не найден. Пожалуйста, создайте новый заказ.");
    return;
  }

  if (order.status !== "awaiting_receipt") {
    ctx.session.awaitingReceiptOrderId = undefined;
    await ctx.reply("Для этого заказа чек уже обработан. Если нужно, создайте новый заказ.");
    return;
  }

  const updatedOrder = await updateOrderStatus(order.id, "pending_review");
  ctx.session.awaitingReceiptOrderId = undefined;

  await notifyAdminsAboutReceipt(updatedOrder ?? order, receipt);

  await ctx.reply(
    [
      "Чек получен и отправлен администратору на проверку.",
      "",
      formatOrderSummary(updatedOrder ?? order),
    ].join("\n"),
    Markup.inlineKeyboard([
      [Markup.button.callback("Проверить заказ", `check_order_${order.id}`)],
    ]),
  );
});

bot.on("message", async (ctx, next) => {
  if (ctx.session.awaitingGiftRecipientUsername && "text" in ctx.message) {
    const recipientUsername = normalizeUsername(ctx.message.text);

    if (!recipientUsername) {
      await ctx.reply("Не удалось распознать username. Пожалуйста, отправьте его ещё раз.");
      return;
    }

    ctx.session.purchaseMode = "gift";
    ctx.session.giftRecipientUsername = recipientUsername;
    ctx.session.awaitingGiftRecipientUsername = undefined;

    await showPremiumMenu(
      ctx,
      [
        `Получатель подарка: @${recipientUsername}`,
        "",
        "Теперь выберите тариф Telegram Premium:",
      ].join("\n"),
    );
    return;
  }

  if (ctx.session.awaitingGiftRecipientUsername) {
    await ctx.reply("Сейчас мы ждём username получателя подарка текстом.");
    return;
  }

  if (ctx.session.awaitingReceiptOrderId) {
    const receipt = extractReceipt(ctx.message);
    if (!receipt) {
      await ctx.reply("Сейчас мы ждём от вас чек. Пожалуйста, отправьте фото или документ с подтверждением оплаты.");
      return;
    }
  }

  await next();
});

bot.action(/check_order_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();

  const orderId = ctx.match[1];
  if (!orderId) {
    await ctx.reply("Неверный идентификатор заказа.");
    return;
  }

  const order = await getOrderById(orderId);
  if (!order) {
    await ctx.reply("Заказ не найден.");
    return;
  }

  await ctx.reply(
    [
      "Статус заказа",
      "",
      formatOrderSummary(order),
      `Создан: ${order.createdAt}`,
    ].join("\n"),
  );
});

bot.action("my_last_order", async (ctx) => {
  await ctx.answerCbQuery();

  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply("Не удалось определить пользователя Telegram.");
    return;
  }

  const userOrders = await getUserOrders(userId);
  const lastOrder = userOrders[0];

  if (!lastOrder) {
    await ctx.reply("У вас пока нет заказов.");
    return;
  }

  await ctx.reply(
    [
      "Ваш последний заказ",
      "",
      formatOrderSummary(lastOrder),
    ].join("\n"),
  );
});

bot.action(/admin_(approve|decline)_(.+)/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) {
    await ctx.answerCbQuery("Только для администраторов.", { show_alert: true });
    return;
  }

  const decision = ctx.match[1];
  const orderId = ctx.match[2];

  if (!orderId || (decision !== "approve" && decision !== "decline")) {
    await ctx.answerCbQuery("Недопустимое действие администратора.", { show_alert: true });
    return;
  }

  await ctx.answerCbQuery(
    decision === "approve" ? "Заказ одобряется..." : "Заказ отклоняется...",
  );

  const result = await handleAdminDecision(orderId, decision);
  await ctx.editMessageCaption(result.finalText, {
    reply_markup: {
      inline_keyboard: [],
    },
  }).catch(async () => {
    await ctx.editMessageText(result.finalText);
  });
});

bot.command("approve", async (ctx) => {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) {
    await ctx.reply("Только для администраторов.");
    return;
  }

  const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
  const [, orderId] = text.trim().split(/\s+/, 2);

  if (!orderId) {
    await ctx.reply("Использование: /approve ORDER_ID");
    return;
  }

  const result = await handleAdminDecision(orderId, "approve");
  await ctx.reply(result.finalText);
});

bot.command("decline", async (ctx) => {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) {
    await ctx.reply("Только для администраторов.");
    return;
  }

  const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
  const [, orderId] = text.trim().split(/\s+/, 2);

  if (!orderId) {
    await ctx.reply("Использование: /decline ORDER_ID");
    return;
  }

  const result = await handleAdminDecision(orderId, "decline");
  await ctx.reply(result.finalText);
});

bot.catch((err, ctx) => {
  console.error("Bot error:", err);
  void ctx.reply("Что-то пошло не так. Пожалуйста, попробуйте ещё раз.");
});

bot.launch().then(() => {
  console.log("Telegram-бот запущен");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
