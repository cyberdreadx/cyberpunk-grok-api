export const AGE_VERIFIED_KEY = "age-verified";
export const AGE_VERIFIED_EVENT = "age-verified:confirmed";

export function isAgeVerified() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AGE_VERIFIED_KEY) === "true";
}