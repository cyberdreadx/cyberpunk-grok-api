import { Context, NextFunction } from "grammy";
import { ensureTelegramUser } from "../db.js";

export interface TgUser {
  id: string;
  telegramId: number;
  credits: number;
  linkedUserId: string | null;
}

export interface BotContext extends Context {
  tgUser: TgUser;
}

export async function authMiddleware(ctx: BotContext, next: NextFunction) {
  const from = ctx.from;
  if (!from) return;

  const row = await ensureTelegramUser(from.id, from.username, from.first_name);
  ctx.tgUser = {
    id: row.id,
    telegramId: row.telegram_id,
    credits: row.credits,
    linkedUserId: row.linked_user_id,
  };

  await next();
}
