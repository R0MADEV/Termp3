import { test, expect } from "bun:test";
import { eqFilterChain, EQ_BANDS } from "./player.ts";

test("eqFilterChain returns empty for flat gains", () => {
  expect(eqFilterChain(new Array(EQ_BANDS.length).fill(0))).toBe("");
});

test("eqFilterChain builds an mpv lavfi chain when a band is set", () => {
  const gains = new Array(EQ_BANDS.length).fill(0);
  gains[0] = 6;
  const out = eqFilterChain(gains);
  expect(out.startsWith("lavfi=[")).toBe(true);
  expect(out).toContain("equalizer=f=31:width_type=o:width=1:g=6.0");
  // One filter per band.
  expect(out.split("equalizer=").length - 1).toBe(EQ_BANDS.length);
});

test("eqFilterChain treats tiny gains as flat", () => {
  expect(eqFilterChain([0.001, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe("");
});
