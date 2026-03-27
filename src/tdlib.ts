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

  console.log("Logged in!");

  const username = await askUsername();
  const targetChat = await client.invoke({
    _: "searchPublicChat",
    username,
  });

  await client.invoke({
    _: "sendMessage",
    chat_id: targetChat.id,
    input_message_content: {
      _: "inputMessageText",
      text: {
        _: "formattedText",
        text: "Hello from TDLib 🚀",
      },
    },
  });

  console.log("Message sent");
}

start()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
