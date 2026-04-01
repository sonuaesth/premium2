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
  const username = (await ask("Enter Telegram username: ")).trim();
  return username.startsWith("@") ? username.slice(1) : username;
}

const premiumDurations = ["3", "6", "12"] as const;
type PremiumDuration = (typeof premiumDurations)[number];

function buildPremiumQuestionText() {
  return [
    "Which Telegram Premium do you want?",
    "Reply with one of these options:",
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
      `Fragment worker Python was not found at ${fragmentWorkerPythonPath}.`
    );
  }

  if (!existsSync(fragmentWorkerScriptPath)) {
    throw new Error(
      `Fragment worker script was not found at ${fragmentWorkerScriptPath}.`
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
      `Fragment worker returned no output.${stderr ? ` stderr: ${stderr.trim()}` : ""}`
    );
  }

  let result: FragmentGiftResult;
  try {
    result = JSON.parse(output) as FragmentGiftResult;
  } catch (error) {
    throw new Error(
      `Fragment worker returned invalid JSON: ${output}${stderr ? ` | stderr: ${stderr.trim()}` : ""}`
    );
  }

  if (!result.success) {
    throw new Error(result.error ?? "Fragment gift worker failed.");
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
              text: "Please reply with 3, 6, or 12.",
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
  await client.invoke({
    _: "sendMessage",
    chat_id: targetChat.id,
    input_message_content: {
      _: "inputMessageText",
      text: {
        _: "formattedText",
        text: "Processing your Telegram Premium gift...",
      },
    },
  });

  let giftResult: FragmentGiftResult;
  try {
    giftResult = await giftPremiumViaFragment(username, selectedDuration);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.invoke({
      _: "sendMessage",
      chat_id: targetChat.id,
      input_message_content: {
        _: "inputMessageText",
        text: {
          _: "formattedText",
          text: `Could not complete the Premium gift: ${message}`,
        },
      },
    });
    throw error;
  }

  await client.invoke({
    _: "sendMessage",
    chat_id: targetChat.id,
    input_message_content: {
      _: "inputMessageText",
      text: {
        _: "formattedText",
        text:
          `Gifted Telegram Premium for ${selectedDuration} month(s).` +
          (giftResult.required_amount != null
            ? ` Paid: ${giftResult.required_amount} TON.`
            : ""),
      },
    },
  });

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
