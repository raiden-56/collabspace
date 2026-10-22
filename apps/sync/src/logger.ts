import pino from "pino";

const pretty = process.env.NODE_ENV !== "production" && process.env.LOG_PRETTY !== "false";
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  name: "sync",
  ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } } } : {}),
});
