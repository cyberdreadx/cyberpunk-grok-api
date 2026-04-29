function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  botToken: required("TELEGRAM_BOT_TOKEN"),
  databaseUrl: required("DATABASE_URL"),

  runpodApiKey: required("RUNPOD_API_KEY"),
  runpodImageEndpoint: required("RUNPOD_ENDPOINT_ID"),
  runpodVideoEndpoint: required("RUNPOD_WAN_ENDPOINT_ID"),

  xrgeDepositAddress: process.env.XRGE_DEPOSIT_ADDRESS || "",
  baseRpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  xrgeUsdRateOverride: process.env.XRGE_USD_RATE || "",
};

export const COSTS = {
  edit: 2,
  video: 5,
  videoHd: 7,
} as const;

export const CREDIT_PACKS = [
  { id: "starter", credits: 75,   priceCents: 699,   stars: 105,  label: "Starter" },
  { id: "pro",     credits: 240,  priceCents: 1899,  stars: 285,  label: "Pro" },
  { id: "mega",    credits: 600,  priceCents: 4299,  stars: 645,  label: "Mega" },
  { id: "ultra",   credits: 2600, priceCents: 17999, stars: 2700, label: "Ultra" },
] as const;

export const XRGE_BONUS_MULTIPLIER = 0.30;

export const JOB_POLL_INTERVAL_MS = 3_000;
export const JOB_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
