import { BotContext } from "../middleware/auth.js";
import { config, COSTS } from "../config.js";
import { getCredits, deductCredits, createJob } from "../db.js";
import { downloadTelegramFile } from "../utils/media.js";
import { buildFlux2KleinEditWorkflow, buildGltchWanWorkflow, WAN_DEFAULT_NEGATIVE } from "../workflows/comfyui.js";
import { submitWorkflow } from "../workflows/runpod.js";

async function getPhotoFileId(ctx: BotContext): Promise<string | null> {
  // Photo attached directly
  if (ctx.message?.photo && ctx.message.photo.length > 0) {
    return ctx.message.photo[ctx.message.photo.length - 1].file_id;
  }
  // Document (uncompressed image)
  if (ctx.message?.document?.mime_type?.startsWith("image/")) {
    return ctx.message.document.file_id;
  }
  // Reply to a photo message
  const reply = ctx.message?.reply_to_message;
  if (reply) {
    if (reply.photo && reply.photo.length > 0) {
      return reply.photo[reply.photo.length - 1].file_id;
    }
    if (reply.document?.mime_type?.startsWith("image/")) {
      return reply.document.file_id;
    }
  }
  return null;
}

function extractPrompt(text: string | undefined, command: string): string {
  if (!text) return "";
  return text.replace(new RegExp(`^/${command}(@\\w+)?\\s*`, "i"), "").trim();
}

export async function editCommand(ctx: BotContext) {
  const prompt = extractPrompt(ctx.message?.text || ctx.message?.caption, "edit");
  const fileId = await getPhotoFileId(ctx);

  if (!fileId) {
    await ctx.reply("Please attach a photo or reply to a photo with /edit `your prompt`", { parse_mode: "Markdown" });
    return;
  }
  if (!prompt) {
    await ctx.reply("Please include a prompt. Example: /edit `cyberpunk portrait, neon lights`", { parse_mode: "Markdown" });
    return;
  }

  const cost = COSTS.edit;
  const credits = await getCredits(ctx.tgUser.id, ctx.tgUser.linkedUserId);
  if (credits < cost) {
    await ctx.reply(`Not enough credits. You have ${credits}, need ${cost}.\nUse /buy to get more.`);
    return;
  }

  const statusMsg = await ctx.reply("\u23F3 Generating image edit...");

  try {
    const imageBuffer = await downloadTelegramFile(config.botToken, fileId);
    const imageBase64 = imageBuffer.toString("base64");
    const imageFilename = `tg_upload_${Date.now()}.png`;

    const seed = Math.floor(Math.random() * 2147483647);
    const workflow = buildFlux2KleinEditWorkflow({
      prompt,
      imageFilename,
      seed,
      steps: 20,
      cfg: 5,
    });

    const deducted = await deductCredits(ctx.tgUser.id, ctx.tgUser.linkedUserId, cost);
    if (!deducted) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, "Not enough credits. Use /buy to get more.");
      return;
    }

    const images = { [imageFilename]: imageBase64 };
    const result = await submitWorkflow(config.runpodImageEndpoint, workflow, images);

    await createJob({
      telegramUserId: ctx.tgUser.id,
      chatId: ctx.chat!.id,
      messageId: statusMsg.message_id,
      runpodJobId: result.jobId,
      endpointId: result.endpointId,
      jobType: "edit",
      outputType: "image",
      creditsUsed: cost,
    });

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "\u23F3 Image edit submitted! I'll send the result when it's ready (usually 15-30 seconds).",
    );
  } catch (err: any) {
    console.error("[edit] Error:", err.message);
    await addCredits(ctx.tgUser.id, ctx.tgUser.linkedUserId, cost).catch(() => {});
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `Generation failed: ${err.message?.slice(0, 200) || "Unknown error"}`,
    );
  }
}

export async function videoCommand(ctx: BotContext) {
  const prompt = extractPrompt(ctx.message?.text || ctx.message?.caption, "video");
  const fileId = await getPhotoFileId(ctx);

  if (!fileId) {
    await ctx.reply("Please attach a photo or reply to a photo with /video `your prompt`", { parse_mode: "Markdown" });
    return;
  }
  if (!prompt) {
    await ctx.reply("Please include a prompt. Example: /video `woman walking through neon city`", { parse_mode: "Markdown" });
    return;
  }

  const cost = COSTS.video;
  const credits = await getCredits(ctx.tgUser.id, ctx.tgUser.linkedUserId);
  if (credits < cost) {
    await ctx.reply(`Not enough credits. You have ${credits}, need ${cost}.\nUse /buy to get more.`);
    return;
  }

  const statusMsg = await ctx.reply("\u23F3 Generating video...");

  try {
    const imageBuffer = await downloadTelegramFile(config.botToken, fileId);
    const imageBase64 = imageBuffer.toString("base64");
    const imageFilename = `tg_upload_${Date.now()}.png`;

    const seed = Math.floor(Math.random() * 2147483647);
    const workflow = buildGltchWanWorkflow({
      prompt,
      imageFilename,
      width: 480,
      height: 832,
      seed,
      steps: 20,
      cfg: 4.5,
      frameCount: 81,
      resolution: 480,
    });

    const deducted = await deductCredits(ctx.tgUser.id, ctx.tgUser.linkedUserId, cost);
    if (!deducted) {
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, "Not enough credits. Use /buy to get more.");
      return;
    }

    const images = { [imageFilename]: imageBase64 };
    const result = await submitWorkflow(config.runpodVideoEndpoint, workflow, images);

    await createJob({
      telegramUserId: ctx.tgUser.id,
      chatId: ctx.chat!.id,
      messageId: statusMsg.message_id,
      runpodJobId: result.jobId,
      endpointId: result.endpointId,
      jobType: "video",
      outputType: "video",
      creditsUsed: cost,
    });

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "\u23F3 Video submitted! This takes 1-3 minutes. I'll send it when ready.",
    );
  } catch (err: any) {
    console.error("[video] Error:", err.message);
    await addCredits(ctx.tgUser.id, ctx.tgUser.linkedUserId, cost).catch(() => {});
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      `Generation failed: ${err.message?.slice(0, 200) || "Unknown error"}`,
    );
  }
}

// Re-export for refund usage in catch blocks
import { addCredits } from "../db.js";
