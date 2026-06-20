import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  [key: string]: string | number | boolean | null | undefined;
}

const DEFAULT_LOG_PATH = ".data/server.log";
let writeChain = Promise.resolve();

function getLogPath(): string {
  return process.env.SERVER_LOG_PATH ?? DEFAULT_LOG_PATH;
}

function serializeContext(context: LogContext | undefined): string {
  if (!context || Object.keys(context).length === 0) {
    return "";
  }

  return ` ${JSON.stringify(context)}`;
}

function writeLine(line: string): void {
  const logPath = getLogPath();

  writeChain = writeChain
    .then(async () => {
      await mkdir(dirname(logPath), { recursive: true });
      await appendFile(logPath, `${line}\n`, "utf8");
    })
    .catch((error: unknown) => {
      console.error("Failed to write server log", error);
    });
}

export function log(level: LogLevel, message: string, context?: LogContext): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${serializeContext(context)}`;

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  writeLine(line);
}

export function logInfo(message: string, context?: LogContext): void {
  log("info", message, context);
}

export function logWarn(message: string, context?: LogContext): void {
  log("warn", message, context);
}

export function logError(message: string, context?: LogContext): void {
  log("error", message, context);
}
