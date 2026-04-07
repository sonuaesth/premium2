import { execFile } from "node:child_process";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process, { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { getTdjson } from "prebuilt-tdlib";
import { configure, createClient } from "tdl";

const env = config().parsed ?? {};
const apiId = Number(env.API_ID);
const apiHash = env.API_HASH;
const adminId = Number(env.ADMIN_ID);
const appVersion = env.APP_VERSION ?? "1.0.0";
const configuredTdjsonPath = env.TDJSON_PATH;

if (!Number.isFinite(apiId)) {
  throw new Error("В .env отсутствует API_ID или указано некорректное значение");
}

if (!apiHash) {
  throw new Error("В .env отсутствует API_HASH");
}

if (!Number.isFinite(adminId)) {
  throw new Error("В .env отсутствует ADMIN_ID или указано некорректное значение");
}

if (configuredTdjsonPath && !existsSync(configuredTdjsonPath)) {
  throw new Error(
    `TDJSON_PATH указывает на отсутствующий файл: ${configuredTdjsonPath}. ` +
      "Поместите tdjson.dll по этому пути, удалите TDJSON_PATH для использования prebuilt-tdlib или обновите TDJSON_PATH в .env."
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
    "TDLib не найден. Установите prebuilt-tdlib или укажите TDJSON_PATH в .env " +
      "до вашего файла tdjson.dll, например C:\\path\\to\\tdjson.dll."
  );
}

const rl = createInterface({ input, output });
const execFileAsync = promisify(execFile);
const projectRoot = process.cwd();
const fragmentWorkerScriptPath = path.join(
  projectRoot,
  "fragment_worker",
  "gift_premium.py"
);
const fragmentWorkerPythonPath = path.join(
  projectRoot,
  "fragment_worker",
  ".venv",
  "Scripts",
  "python.exe"
);

function ask(question: string) {
  return rl.question(question);
}

async function askUsername() {
  const username = (await ask("Введите username Telegram: ")).trim();
  return username.startsWith("@") ? username.slice(1) : username;
}

const premiumDurations = ["3", "6", "12"] as const;
type PremiumDuration = (typeof premiumDurations)[number];
type AdminDecision = "approve" | "decline";

function buildPremiumQuestionText() {
  return [
    "Какой Telegram Premium вы хотите?",
    "Ответьте одним из вариантов:",
    "3 - 3 месяца",
    "6 - 6 месяцев",
    "12 - 12 месяцев",
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

function parseAdminDecision(text: string) {
  const match = text.trim().match(/^(approve|decline)\s+(\d+)$/i);
  if (!match) {
    return undefined;
  }

  return {
    decision: match[1].toLowerCase() as AdminDecision,
    orderId: Number(match[2]),
  };
}

async function sendTextMessage(chatId: number, text: string) {
  await client.invoke({
    _: "sendMessage",
    chat_id: chatId,
    input_message_content: {
      _: "inputMessageText",
      text: {
        _: "formattedText",
        text,
      },
    },
  });
}

let nextOrderId = 1;

async function waitForAdminDecision(adminChatId: number, orderId: number) {
  return new Promise<AdminDecision>((resolve, reject) => {
    const onUpdate = async (update: any) => {
      if (update._ !== "updateNewMessage" || !update.message) {
        return;
      }

      if (update.message.chat_id !== adminChatId || update.message.is_outgoing) {
        return;
      }

      const text = getMessageText(update.message);
      if (!text) {
        return;
      }

      const parsed = parseAdminDecision(text);
      if (!parsed || parsed.orderId !== orderId) {
        return;
      }

      client.off("update", onUpdate);
      resolve(parsed.decision);
    };

    client.on("update", onUpdate);

    client.invoke({
      _: "sendMessage",
      chat_id: adminChatId,
      input_message_content: {
        _: "inputMessageText",
        text: {
          _: "formattedText",
          text: `Ожидается решение по заказу #${orderId}. Ответьте "approve ${orderId}" или "decline ${orderId}".`,
        },
      },
    }).catch((error) => {
      client.off("update", onUpdate);
      reject(error);
    });
  });
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

type FragmentGiftResult = {
  success: boolean;
  username?: string;
  months?: number;
  transaction_hash?: string | null;
  required_amount?: number | null;
  error?: string;
};

async function giftPremiumViaFragment(username: string, monthCount: PremiumDuration) {
  if (!existsSync(fragmentWorkerPythonPath)) {
    throw new Error(
      `Python для Fragment worker не найден по пути ${fragmentWorkerPythonPath}.`
    );
  }

  if (!existsSync(fragmentWorkerScriptPath)) {
    throw new Error(
      `Скрипт Fragment worker не найден по пути ${fragmentWorkerScriptPath}.`
    );
  }

  let stdout = "";
  let stderr = "";

  try {
    const result = await execFileAsync(
      fragmentWorkerPythonPath,
      [fragmentWorkerScriptPath, username, monthCount],
      {
        cwd: projectRoot,
        env: process.env,
        windowsHide: true,
      }
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const execError = error as Error & { stdout?: string; stderr?: string };
    stdout = execError.stdout ?? "";
    stderr = execError.stderr ?? "";

    if (!stdout.trim()) {
      throw new Error(
        execError.message +
          (stderr.trim() ? ` | stderr: ${stderr.trim()}` : "")
      );
    }
  }

  const output = stdout.trim();
  if (!output) {
    throw new Error(
      `Fragment worker не вернул вывод.${stderr ? ` stderr: ${stderr.trim()}` : ""}`
    );
  }

  let result: FragmentGiftResult;
  try {
    result = JSON.parse(output) as FragmentGiftResult;
  } catch (error) {
    throw new Error(
      `Fragment worker вернул некорректный JSON: ${output}${stderr ? ` | stderr: ${stderr.trim()}` : ""}`
    );
  }

  if (!result.success) {
    throw new Error(result.error ?? "Fragment worker не смог отправить подарок.");
  }

  return result;
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
    const onUpdate = async (update: any) => {
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
              text: "Пожалуйста, ответьте 3, 6 или 12.",
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
      return ask("Введите номер телефона: ");
    },
    getAuthCode: async () => {
      return ask("Введите код: ");
    },
    getPassword: async () => {
      return ask("Пароль 2FA (если есть): ");
    },
  }));

  console.log("Вход выполнен");

  const username = await askUsername();
  const targetChat = await client.invoke({
    _: "searchPublicChat",
    username,
  });

  const adminChat = await client.invoke({
    _: "createPrivateChat",
    user_id: adminId,
    force: false,
  });

  const selectedDuration = await askPremiumDurationInChat(targetChat.id);
  const orderId = nextOrderId++;

  await sendTextMessage(
    targetChat.id,
    "Ваш заказ получен и сейчас проверяется администратором."
  );

  await sendTextMessage(
    adminChat.id,
    [
      `Новый заказ на Premium #${orderId}`,
      `Пользователь: @${username}`,
      `Тариф: ${selectedDuration} мес.`,
      `ID чата пользователя: ${targetChat.id}`,
      `Ответьте: approve ${orderId}`,
      `Или ответьте: decline ${orderId}`,
    ].join("\n")
  );

  const adminDecision = await waitForAdminDecision(adminChat.id, orderId);
  if (adminDecision === "decline") {
    await sendTextMessage(
      targetChat.id,
      "Ваш заказ был отклонён администратором."
    );
    await sendTextMessage(
      adminChat.id,
      `Заказ #${orderId} помечен как отклонённый, пользователь уведомлён.`
    );
    console.log(`Заказ на Premium #${orderId} отклонён`);
    return;
  }

  await sendTextMessage(
    targetChat.id,
    "Ваш заказ одобрен. Выполняем отправку подарка Telegram Premium..."
  );

  let giftResult: FragmentGiftResult;
  try {
    giftResult = await giftPremiumViaFragment(username, selectedDuration);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendTextMessage(
      targetChat.id,
      `Не удалось завершить отправку Premium: ${message}`
    );
    await sendTextMessage(
      adminChat.id,
      `Заказ #${orderId} был одобрен, но отправка подарка не удалась: ${message}`
    );
    throw error;
  }

  await sendTextMessage(
    targetChat.id,
    `Telegram Premium на ${selectedDuration} мес. успешно отправлен.` +
      (giftResult.required_amount != null
        ? ` Оплачено: ${giftResult.required_amount} TON.`
        : "")
  );
  await sendTextMessage(
    adminChat.id,
    `Заказ #${orderId} для @${username} успешно выполнен.`
  );

  console.log(`Premium отправлен по заказу #${orderId}, ${selectedDuration} мес.`);
}

start()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
