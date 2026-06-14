import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} from "discord.js";
import { getDb } from "./db.js";

export interface UserSettings {
  aspect: "landscape" | "portrait" | "square";
  length: 49 | 81 | 113; // frame counts ≈ 3s / 5s / 7s
  sound: boolean; // MMAudio ambient
  quality: "standard" | "hd";
}

export const DEFAULT_SETTINGS: UserSettings = {
  aspect: "landscape", length: 81, sound: false, quality: "standard",
};

export const ASPECT_DIMS: Record<UserSettings["aspect"], { width: number; height: number }> = {
  landscape: { width: 832, height: 480 },
  portrait: { width: 480, height: 832 },
  square: { width: 640, height: 640 },
};

const LENGTHS: { label: string; value: UserSettings["length"] }[] = [
  { label: "3s", value: 49 }, { label: "5s", value: 81 }, { label: "7s", value: 113 },
];

export async function getSettings(discordId: string): Promise<UserSettings> {
  const sql = getDb();
  const rows = await sql`SELECT settings FROM discord_users WHERE discord_id = ${discordId} LIMIT 1`;
  return { ...DEFAULT_SETTINGS, ...((rows[0]?.settings as Partial<UserSettings>) || {}) };
}

export async function saveSettings(discordId: string, s: UserSettings): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO discord_users (discord_id, settings)
    VALUES (${discordId}, ${JSON.stringify(s)}::jsonb)
    ON CONFLICT (discord_id) DO UPDATE SET settings = ${JSON.stringify(s)}::jsonb, updated_at = now()
  `;
}

/** The interactive panel (content + components) reflecting the current settings. */
export function buildPanel(s: UserSettings) {
  const lenLabel = LENGTHS.find((l) => l.value === s.length)?.label ?? "5s";
  const content =
    `⚙️ **Your GLTCH settings** _(saved automatically, applied to /generate + /animate)_\n` +
    `Aspect **${s.aspect}** · Length **${lenLabel}** · Sound **${s.sound ? "On" : "Off"}** · Quality **${s.quality}**\n` +
    `_Inline options (e.g. \`aspect:\`) override these per command._`;

  const aspectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId("set:aspect").setPlaceholder("Aspect ratio").addOptions(
      { label: "Landscape 16:9", value: "landscape", default: s.aspect === "landscape" },
      { label: "Portrait 9:16", value: "portrait", default: s.aspect === "portrait" },
      { label: "Square 1:1", value: "square", default: s.aspect === "square" },
    ),
  );
  const lengthRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...LENGTHS.map((l) => new ButtonBuilder()
      .setCustomId(`set:length:${l.value}`).setLabel(l.label)
      .setStyle(s.length === l.value ? ButtonStyle.Primary : ButtonStyle.Secondary)),
  );
  const soundRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("set:sound:off").setLabel("🔇 Sound Off")
      .setStyle(!s.sound ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("set:sound:on").setLabel("🔊 Sound On")
      .setStyle(s.sound ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  const qualityRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("set:quality:standard").setLabel("Standard")
      .setStyle(s.quality === "standard" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("set:quality:hd").setLabel("HD")
      .setStyle(s.quality === "hd" ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("set:reset").setLabel("Reset").setStyle(ButtonStyle.Danger),
  );

  return { content, components: [aspectRow, lengthRow, soundRow, qualityRow] };
}

/** Apply a component customId (+ optional select value) to settings → new settings. */
export function applyChange(s: UserSettings, customId: string, selectValue?: string): UserSettings {
  if (customId === "set:reset") return { ...DEFAULT_SETTINGS };
  const next = { ...s };
  if (customId === "set:aspect" && selectValue) {
    next.aspect = selectValue as UserSettings["aspect"];
    return next;
  }
  const [, key, val] = customId.split(":");
  if (key === "length") next.length = Number(val) as UserSettings["length"];
  else if (key === "sound") next.sound = val === "on";
  else if (key === "quality") next.quality = val as UserSettings["quality"];
  return next;
}
