import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const workerRoot = path.resolve(
  process.cwd(),
  process.env.FRAGMENT_WORKER_ROOT ?? "../fragment_worker",
);
const fragmentWorkerScriptPath = path.join(workerRoot, "gift_premium.py");

type WorkerMonthCount = "3" | "6" | "12";

export type FragmentGiftResult = {
  success: boolean;
  username?: string;
  months?: number;
  transaction_hash?: string | null;
  required_amount?: number | null;
  error?: string;
};

function toWorkerMonthCount(months: number): WorkerMonthCount {
  if (months === 3 || months === 6 || months === 12) {
    return String(months) as WorkerMonthCount;
  }

  throw new Error(`Неподдерживаемая длительность Premium: ${months}`);
}

function resolveFragmentWorkerPython() {
  const configuredPath = process.env.FRAGMENT_WORKER_PYTHON?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const platformPythonPath =
    os.platform() === "win32"
      ? path.join(workerRoot, ".venv", "Scripts", "python.exe")
      : path.join(workerRoot, ".venv", "bin", "python");

  if (existsSync(platformPythonPath)) {
    return platformPythonPath;
  }

  return os.platform() === "win32" ? "python" : "python3";
}

export async function giftPremiumViaFragment(
  username: string,
  months: number,
): Promise<FragmentGiftResult> {
  const fragmentWorkerPythonPath = resolveFragmentWorkerPython();

  if (
    path.isAbsolute(fragmentWorkerPythonPath) &&
    !existsSync(fragmentWorkerPythonPath)
  ) {
    throw new Error(
      `Python для Fragment worker не найден по пути ${fragmentWorkerPythonPath}.`,
    );
  }

  if (!existsSync(fragmentWorkerScriptPath)) {
    throw new Error(
      `Скрипт Fragment worker не найден по пути ${fragmentWorkerScriptPath}.`,
    );
  }

  let stdout = "";
  let stderr = "";

  try {
    const result = await execFileAsync(
      fragmentWorkerPythonPath,
      [fragmentWorkerScriptPath, username, toWorkerMonthCount(months)],
      {
        cwd: workerRoot,
        env: process.env,
        windowsHide: true,
      },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const execError = error as Error & { stdout?: string; stderr?: string };
    stdout = execError.stdout ?? "";
    stderr = execError.stderr ?? "";

    if (!stdout.trim()) {
      throw new Error(
        execError.message + (stderr.trim() ? ` | stderr: ${stderr.trim()}` : ""),
      );
    }
  }

  const output = stdout.trim();
  if (!output) {
    throw new Error(
      `Fragment worker не вернул вывод.${stderr ? ` stderr: ${stderr.trim()}` : ""}`,
    );
  }

  let result: FragmentGiftResult;
  try {
    result = JSON.parse(output) as FragmentGiftResult;
  } catch {
    throw new Error(
      `Fragment worker вернул некорректный JSON: ${output}${stderr ? ` | stderr: ${stderr.trim()}` : ""}`,
    );
  }

  if (!result.success) {
    throw new Error(result.error ?? "Fragment worker не смог отправить подарок.");
  }

  return result;
}
