/**
 * Mode resolution — the rules that decide whether a user lands in Easy or
 * Classic. Getting this wrong moves people out of the UI they know, which is
 * the one thing the feature must not do.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveCreateMode,
  setCreateMode,
  setCreateModeDefaultForNewAccount,
  getAssist,
  setAssist,
} from "./createMode";

beforeEach(() => localStorage.clear());

describe("resolveCreateMode", () => {
  it("defaults to Classic for an account with no stored preference", () => {
    expect(resolveCreateMode("")).toBe("classic");
  });

  it("honours a stored preference", () => {
    setCreateMode("easy");
    expect(resolveCreateMode("")).toBe("easy");
    setCreateMode("classic");
    expect(resolveCreateMode("")).toBe("classic");
  });

  it("lets ?mode= win over the stored preference, both ways", () => {
    setCreateMode("classic");
    expect(resolveCreateMode("?mode=easy")).toBe("easy");
    setCreateMode("easy");
    expect(resolveCreateMode("?mode=classic")).toBe("classic");
  });

  it("sends Library edit/animate deep links to Classic even for an Easy user", () => {
    setCreateMode("easy");
    expect(resolveCreateMode("?action=edit")).toBe("classic");
    expect(resolveCreateMode("?action=animate")).toBe("classic");
  });

  it("sends shared-prompt links to Classic", () => {
    setCreateMode("easy");
    expect(resolveCreateMode("?prompt=a%20cat")).toBe("classic");
  });

  it("still lets an explicit ?mode=easy beat a deep link", () => {
    setCreateMode("classic");
    expect(resolveCreateMode("?action=edit&mode=easy")).toBe("easy");
  });

  it("ignores unrelated params like ?signup=1 and ?store=1", () => {
    setCreateMode("easy");
    expect(resolveCreateMode("?signup=1")).toBe("easy");
    expect(resolveCreateMode("?store=1")).toBe("easy");
  });

  it("ignores a junk mode value rather than throwing", () => {
    setCreateMode("classic");
    expect(resolveCreateMode("?mode=banana")).toBe("classic");
  });
});

describe("new-account default", () => {
  it("puts a brand-new account in Easy", () => {
    setCreateModeDefaultForNewAccount();
    expect(resolveCreateMode("")).toBe("easy");
  });

  it("never overwrites a choice the user already made", () => {
    setCreateMode("classic");
    setCreateModeDefaultForNewAccount();
    expect(resolveCreateMode("")).toBe("classic");
  });
});

describe("prompt assist", () => {
  it("is off unless switched on — it spends a credit per message", () => {
    expect(getAssist()).toBe(false);
    setAssist(true);
    expect(getAssist()).toBe(true);
    setAssist(false);
    expect(getAssist()).toBe(false);
  });
});
