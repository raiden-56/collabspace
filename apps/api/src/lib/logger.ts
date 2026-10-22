import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const pretty = process.env.NODE_ENV !== "production" && process.env.LOG_PRETTY !== "false";

export const logger = pino({
  level,
  redact: { paths: ["req.headers.cookie", "req.headers.authorization", "*.password", "*.passwordHash", "*.token"], censor: "[redacted]" },
  ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } } } : {}),
});
