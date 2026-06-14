/**
 * Registers the slash commands globally, enabled for BOTH guild-install and
 * user-install, and usable in guilds, bot DMs, and private channels — so users
 * can run them in their DMs. Run once after changing commands: `npm run register`.
 *
 * integration_types: [0]=GUILD_INSTALL, [1]=USER_INSTALL
 * contexts:          [0]=GUILD, [1]=BOT_DM, [2]=PRIVATE_CHANNEL
 */
import { REST, Routes } from "discord.js";
import { config } from "./config.js";

const commands = [
  {
    name: "link",
    description: "Link your GltchRunner web account to use your credits here",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "balance",
    description: "Show your GltchRunner credit balance",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
  {
    name: "generate",
    description: "Generate an image from a prompt",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      { name: "prompt", description: "What to generate", type: 3 /* STRING */, required: true },
    ],
  },
  {
    name: "animate",
    description: "Generate a video. Attach an image to animate it, or just give a prompt.",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      { name: "prompt", description: "Scene / motion to render", type: 3 /* STRING */, required: true },
      { name: "image", description: "Optional start frame to animate", type: 11 /* ATTACHMENT */, required: false },
    ],
  },
  {
    name: "help",
    description: "How to use the GltchRunner bot",
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

const rest = new REST({ version: "10" }).setToken(config.discordToken);
await rest.put(Routes.applicationCommands(config.discordClientId), { body: commands });
console.log(`Registered ${commands.length} commands (guild + user install, DM-enabled).`);
