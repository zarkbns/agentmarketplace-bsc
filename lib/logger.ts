import { pino } from "pino";
import { serverEnv } from "./env";

const isServer = typeof window === "undefined";

function createLogger() {
  if (!isServer) {
    return pino({ level: "silent" });
  }
  return pino({
    level: serverEnv().LOG_LEVEL,
    base: { service: "agentgrid" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.cookie",
        "*.signature",
        "*.sig",
        "*.session",
        "*.privateKey",
        "*.secret",
        "*.apiKey",
        "*.token",
        "*.message", // signed auth messages
        "req.body.message",
        "req.body.signature",
      ],
      censor: "[REDACTED]",
    },
  });
}

export const logger = createLogger();
