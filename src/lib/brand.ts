/** Product branding — site URL stays grokrunner.gltch.app until DNS moves. */
export const BRAND = {
  name: "GLTCHRunner",
  nameCaps: "GLTCH RUNNER",
  nameHeader: "GLTCHRUNNER",
  tagline: "AI image & video — GLTCH engines, fewer limits",
  siteUrl: "https://grokrunner.gltch.app",
  // Public link domain for anything posted on social — gltch.app is blocked
  // on Reddit/X, so shared/referral links must live on gltchrunner.com
  // (nginx on the prod box serves /s/ and redirects /r/<code> into the app).
  publicUrl: "https://gltchrunner.com",
  reddit: "grokrunner",
} as const;
