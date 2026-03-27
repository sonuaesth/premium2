import { config } from "dotenv";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process, { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { getTdjson } from "prebuilt-tdlib";
import { configure, createClient } from "tdl";

const env = config().parsed ?? {};
const apiId = Number(env.API_ID);
const apiHash = env.API_HASH;
const appVersion = env.APP_VERSION ?? "1.0.0";
const configuredTdjsonPath = env.TDJSON_PATH;

if (!Number.isFinite(apiId)) {
  throw new Error("Missing or invalid API_ID in .env");
}

if (!apiHash) {
  throw new Error("Missing API_HASH in .env");
}

if (configuredTdjsonPath && !existsSync(configuredTdjsonPath)) {
  throw new Error(
    `TDJSON_PATH points to a missing file: ${configuredTdjsonPath}. ` +
      "Put tdjson.dll at that path, remove TDJSON_PATH to use prebuilt-tdlib, or update TDJSON_PATH in .env."
  );
}

const bundledTdjsonPath =
  !configuredTdjsonPath && process.platform === "win32" ? getTdjson() : undefined;
const tdjsonPath =
  configuredTdjsonPath ??
  bundledTdjsonPath ??
  [
    "C:\\tdlib\\tdjson.dll",
    path.join(process.cwd(), "tdlib", "tdjson.dll"),
    "/opt/homebrew/lib/libtdjson.dylib",
    "/usr/local/lib/libtdjson.dylib",
    "/opt/homebrew/opt/tdlib/lib/libtdjson.dylib",
    "/usr/local/opt/tdlib/lib/libtdjson.dylib",
  ].find((value) => existsSync(value));

if (tdjsonPath) {
  configure({
    libdir: path.dirname(tdjsonPath),
    tdjson: path.basename(tdjsonPath),
  });
} else if (process.platform === "win32") {
  throw new Error(
    "TDLib was not found. Install prebuilt-tdlib or set TDJSON_PATH in .env " +
      "to your tdjson.dll file, for example C:\\path\\to\\tdjson.dll."
  );
}

const rl = createInterface({ input, output });

function ask(question: string) {
  return rl.question(question);
}

async function askUsername() {
  const username = (await ask("Enter Telegram username: ")).trim();
  return username.startsWith("@") ? username.slice(1) : username;
}

const premiumDurations = ["1", "3", "6", "12"] as const;
type PremiumDuration = (typeof premiumDurations)[number];

function buildPremiumQuestionText() {
  return [
    "Which Telegram Premium do you want?",
    "Reply with one of these options:",
    "1 - 1 month",
    "3 - 3 months",
    "6 - 6 months",
    "12 - 12 months",
  ].join("\n");
}

function getMessageText(message: {
  content?: {
    _: string;
    text?: {
      text?: string;
    };
  };
}) {
  if (message.content?._ !== "messageText") {
    return undefined;
  }

  return message.content.text?.text?.trim();
}

function isPremiumDuration(value: string): value is PremiumDuration {
  return premiumDurations.includes(value as PremiumDuration);
}

export const client = createClient({
  apiId,
  apiHash,
  tdlibParameters: {
    use_message_database: true,
    use_secret_chats: false,
    system_language_code: env.SYSTEM_LANGUAGE_CODE ?? "en",
    application_version: appVersion,
    device_model: env.DEVICE_MODEL ?? os.hostname(),
    system_version: env.SYSTEM_VERSION ?? `${os.platform()} ${os.release()}`,
  },
});

function getPrivateChatUserId(chat: {
  id: number;
  type?: {
    _: string;
    user_id?: number;
  };
}) {
  if (chat.type?._ !== "chatTypePrivate" || !chat.type.user_id) {
    throw new Error(
      `Chat ${chat.id} is not a private user chat, so Telegram Premium can't be gifted to it with this flow.`
    );
  }

  return chat.type.user_id;
}

async function getPremiumGiftStarOption(monthCount: PremiumDuration) {
  const options = await client.invoke({
    _: "getPremiumGiftPaymentOptions",
  });

  const option = options.options?.find(
    (value: {
      month_count?: number;
      currency?: string;
      star_count?: number;
      amount?: number;
    }) =>
      value.month_count === Number(monthCount) &&
      (value.currency === "XTR" || Number(value.star_count) > 0)
  );

  if (!option) {
    throw new Error(
      `Telegram didn't return a Stars premium gift option for ${monthCount} month(s).`
    );
  }

  const starCount =
    typeof option.star_count === "number" && option.star_count > 0
      ? option.star_count
      : option.amount;

  if (typeof starCount !== "number" || starCount <= 0) {
    throw new Error(
      `Telegram returned an invalid Stars amount for ${monthCount} month(s).`
    );
  }

  return {
    monthCount: Number(monthCount),
    starCount,
  };
}

async function giftPremiumForSelection(chat: {
  id: number;
  type?: {
    _: string;
    user_id?: number;
  };
}, monthCount: PremiumDuration) {
  const userId = getPrivateChatUserId(chat);
  const option = await getPremiumGiftStarOption(monthCount);
  const inputInvoice = {
    _: "inputInvoiceTelegram",
    purpose: {
      _: "telegramPaymentPurposePremiumGift",
      user_id: userId,
      currency: "XTR",
      amount: option.starCount,
      month_count: option.monthCount,
      text: {
        _: "formattedText",
        text: `Telegram Premium for ${monthCount} month(s)`,
      },
    },
  } as const;

  const paymentForm = await client.invoke({
    _: "getPaymentForm",
    input_invoice: inputInvoice,
  });

  if (paymentForm.type?._ !== "paymentFormTypeStars") {
    throw new Error(
      `Telegram returned a non-Stars payment form for ${monthCount} month(s).`
    );
  }

  await client.invoke({
    _: "sendPaymentForm",
    input_invoice: inputInvoice,
    payment_form_id: paymentForm.id,
    order_info_id: "",
    shipping_option_id: "",
    credentials: null,
    tip_amount: 0,
  });

  await client.invoke({
    _: "sendMessage",
    chat_id: chat.id,
    input_message_content: {
      _: "inputMessageText",
      text: {
        _: "formattedText",
        text: `Gifted Telegram Premium for ${monthCount} month(s).`,
      },
    },
  });
}

export async function askPremiumDurationInChat(chatId: number) {
  await client.invoke({
    _: "sendMessage",
    chat_id: chatId,
    input_message_content: {
      _: "inputMessageText",
      text: {
        _: "formattedText",
        text: buildPremiumQuestionText(),
      },
    },
  });

  return new Promise<PremiumDuration>((resolve, reject) => {
    const onUpdate = async (update: {
      _: string;
      message?: {
        chat_id: number;
        is_outgoing?: boolean;
        content?: {
          _: string;
          text?: {
            text?: string;
          };
        };
      };
    }) => {
      if (update._ !== "updateNewMessage" || !update.message) {
        return;
      }

      if (update.message.chat_id !== chatId) {
        return;
      }

      if (update.message.is_outgoing) {
        return;
      }

      const text = getMessageText(update.message);
      if (!text) {
        return;
      }

      if (isPremiumDuration(text)) {
        client.off("update", onUpdate);
        resolve(text);
        return;
      }

      try {
        await client.invoke({
          _: "sendMessage",
          chat_id: chatId,
          input_message_content: {
            _: "inputMessageText",
            text: {
              _: "formattedText",
              text: "Please reply with 1, 3, 6, or 12.",
            },
          },
        });
      } catch (error) {
        client.off("update", onUpdate);
        reject(error);
      }
    };

    client.on("update", onUpdate);
  });
}

async function start() {
  await client.login(() => ({
    type: "user",
    getPhoneNumber: async () => {
      return ask("Enter phone number: ");
    },
    getAuthCode: async () => {
      return ask("Enter code: ");
    },
    getPassword: async () => {
      return ask("2FA password (if any): ");
    },
  }));

  console.log("Logged in as user!");

  const username = await askUsername();
  const targetChat = await client.invoke({
    _: "searchPublicChat",
    username,
  });

  const selectedDuration = await askPremiumDurationInChat(targetChat.id);
  await giftPremiumForSelection(targetChat, selectedDuration);
  console.log(`Gifted premium for ${selectedDuration} month(s)`);
}

start()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
