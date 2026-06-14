import "dotenv/config";

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  databaseUrl: required("DATABASE_URL"),
  apiBase: (process.env.API_BASE || "https://api.gltch.app/api").replace(/\/+$/, ""),
  jwtSecret: required("JWT_SECRET"),
  siteUrl: process.env.SITE_URL || "https://grokrunner.gltch.app",
};
