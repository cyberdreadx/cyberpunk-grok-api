import { InputFile } from "grammy";

const TG_FILE_API = "https://api.telegram.org/file/bot";

export async function downloadTelegramFile(botToken: string, fileId: string): Promise<Buffer> {
  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
  const info = (await infoRes.json()) as any;
  if (!info.ok || !info.result?.file_path) {
    throw new Error("Failed to get file path from Telegram");
  }

  const fileUrl = `${TG_FILE_API}${botToken}/${info.result.file_path}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error(`Failed to download file: HTTP ${fileRes.status}`);
  return Buffer.from(await fileRes.arrayBuffer());
}

export function bufferToInputFile(buf: Buffer, filename: string): InputFile {
  return new InputFile(buf, filename);
}

export function bufferToBase64DataUri(buf: Buffer, mimeType = "image/png"): string {
  return `data:${mimeType};base64,${buf.toString("base64")}`;
}

export function isImageMimeType(mime: string | undefined): boolean {
  return !!mime && (mime.startsWith("image/") || ["image/jpeg", "image/png", "image/webp"].includes(mime));
}
