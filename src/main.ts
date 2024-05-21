#!/usr/bin/env tsx

import { serve } from "@hono/node-server";
import { createBot } from "#root/bot/index.js";
import { config } from "#root/config.js";
import { logger } from "#root/logger.js";
import { createServer } from "#root/server/index.js";
import { AddressInfo } from "node:net";

/**
 * Registers shutdown handlers for SIGINT and SIGTERM signals.
 * @param cleanUp - A function that performs cleanup operations.
 * @returns {void}
 */
function onShutdown(cleanUp: () => Promise<void>): void {
  let isShuttingDown = false;
  const handleShutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info("Shutdown");
    await cleanUp();
  };
  process.on("SIGINT", handleShutdown);
  process.on("SIGTERM", handleShutdown);
}

/**
 * Start the bot in polling mode.
 * @returns {Promise<void>} - A promise that resolves when the bot is started.
 */
async function startPolling(): Promise<void> {
  const bot = createBot(config.BOT_TOKEN);

  onShutdown(async () => {
    await bot.stop();
  });
  await bot.start({
    allowed_updates: config.BOT_ALLOWED_UPDATES,
    onStart: ({ username }) =>
      logger.info({
        msg: "Bot running...",
        username,
      }),
  });
}

/**
 * Start the bot in webhook mode.
 * @returns {Promise<void>} - A promise that resolves when the bot is started.
 */
async function startWebhook(): Promise<void> {
  const bot = createBot(config.BOT_TOKEN);
  const server = await createServer(bot);

  let serverHandle: undefined | ReturnType<typeof serve>;
  const startServer = () =>
    new Promise<AddressInfo>((resolve) => {
      serverHandle = serve(
        {
          fetch: server.fetch,
          hostname: config.BOT_SERVER_HOST,
          port: config.BOT_SERVER_PORT,
        },
        (info) => resolve(info),
      );
    });
  const stopServer = async () =>
    new Promise<void>((resolve) => {
      if (serverHandle) {
        serverHandle.close(() => resolve());
      } else {
        resolve();
      }
    });

  onShutdown(async () => {
    await stopServer();
  });
  await bot.init();

  const info = await startServer();
  logger.info({
    msg: "Server started",
    url:
      info.family === "IPv6"
        ? `http://[${info.address}]:${info.port}`
        : `http://${info.address}:${info.port}`,
  });

  await bot.api.setWebhook(config.BOT_WEBHOOK, {
    allowed_updates: config.BOT_ALLOWED_UPDATES,
    secret_token: config.BOT_WEBHOOK_SECRET,
  });
  logger.info({
    msg: "Webhook was set",
    url: config.BOT_WEBHOOK,
  });
}

try {
  if (config.BOT_MODE === "webhook") {
    await startWebhook();
  } else if (config.BOT_MODE === "polling") {
    await startPolling();
  }
} catch (error) {
  logger.error(error);
  process.exit(1);
}
