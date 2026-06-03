import { test, expect } from "bun:test";
import { t, setLocale, detectLocale } from "./i18n.ts";

test("returns the English string by default", () => {
  setLocale("en");
  expect(t("ui.state.play")).toBe("PLAY");
});

test("interpolates {placeholders}", () => {
  setLocale("en");
  expect(t("add.ok", { url: "https://x" })).toContain("https://x");
});

test("switches to Spanish", () => {
  setLocale("es");
  expect(t("doctor.header")).toContain("dependencias");
  setLocale("en");
});

test("falls back to the key when missing", () => {
  setLocale("en");
  expect(t("nope.not.here")).toBe("nope.not.here");
});

test("detectLocale honors TERMP3_LANG and falls back to en", () => {
  const prev = process.env.TERMP3_LANG;
  process.env.TERMP3_LANG = "es";
  expect(detectLocale()).toBe("es");
  process.env.TERMP3_LANG = "fr"; // unsupported
  expect(detectLocale()).toBe("en");
  if (prev === undefined) delete process.env.TERMP3_LANG;
  else process.env.TERMP3_LANG = prev;
});
