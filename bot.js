import { Telegraf } from "telegraf";

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");

  const bot = new Telegraf(token);

  bot.start((ctx) => ctx.reply("سلام! 👋"));
  bot.on("message", (ctx) => ctx.reply("سلام! 👋"));

  bot.launch();
  console.log("Bot started!");

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
  