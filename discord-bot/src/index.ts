import { Client, GatewayIntentBits, Partials, MessageFlags, ChatInputCommandInteraction } from "discord.js";
import { config } from "./config.js";
import { createLinkCode, getCredits, getLinkedWebUser } from "./db.js";
import { mintUserToken } from "./auth.js";
import { generateImage } from "./backend.js";

// DM_MESSAGES intents + Channel partial let the bot operate in direct messages.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

client.once("clientReady", (c) => console.log(`@${c.user.tag} online`));

async function onLink(i: ChatInputCommandInteraction) {
  const code = await createLinkCode(i.user.id, i.user.username);
  await i.reply({
    flags: MessageFlags.Ephemeral,
    content:
      `**Link your GltchRunner account**\n` +
      `1. Open ${config.siteUrl} (logged in)\n` +
      `2. Settings → Link Discord → enter code: **${code}**\n` +
      `Code expires in 15 minutes. Once linked, your web credits work here.`,
  });
}

async function onBalance(i: ChatInputCommandInteraction) {
  const credits = await getCredits(i.user.id);
  if (credits === null) {
    await i.reply({ flags: MessageFlags.Ephemeral, content: "Not linked yet — run `/link` first." });
    return;
  }
  await i.reply({ flags: MessageFlags.Ephemeral, content: `Balance: **${credits}** credits.` });
}

async function onGenerate(i: ChatInputCommandInteraction) {
  const linked = await getLinkedWebUser(i.user.id);
  if (!linked) {
    await i.reply({ flags: MessageFlags.Ephemeral, content: "Not linked yet — run `/link` first." });
    return;
  }
  const prompt = i.options.getString("prompt", true);
  await i.deferReply(); // generation can take 30–120s; defer keeps the interaction alive
  try {
    const token = mintUserToken(linked.userId, linked.email);
    const { url, type } = await generateImage(prompt, token);
    await i.editReply({ content: `**${type}** · "${prompt}"\n${url}` });
  } catch (e: any) {
    await i.editReply({ content: `Generation failed: ${e?.message || "unknown error"}` });
  }
}

async function onHelp(i: ChatInputCommandInteraction) {
  await i.reply({
    flags: MessageFlags.Ephemeral,
    content:
      `**GltchRunner bot**\n` +
      `\`/link\` — connect your web account (use your existing credits)\n` +
      `\`/balance\` — check credits\n` +
      `\`/generate prompt:<text>\` — make an image\n` +
      `Buy credits at ${config.siteUrl}.`,
  });
}

const handlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
  link: onLink, balance: onBalance, generate: onGenerate, help: onHelp,
};

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const handler = handlers[interaction.commandName];
  if (!handler) return;
  try {
    await handler(interaction);
  } catch (e: any) {
    console.error(`[${interaction.commandName}]`, e?.message);
    const msg = { flags: MessageFlags.Ephemeral, content: "Something glitched. Try again." } as const;
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

client.login(config.discordToken);
