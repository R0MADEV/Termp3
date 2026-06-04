import { test, expect } from "bun:test";
import { isPlaylistUrl } from "./playlist.ts";

test("isPlaylistUrl detects real YouTube playlists", () => {
  expect(isPlaylistUrl("https://www.youtube.com/playlist?list=PL123")).toBe(true);
  expect(
    isPlaylistUrl("https://www.youtube.com/watch?v=abc&list=PL123"),
  ).toBe(true);
});

test("isPlaylistUrl treats radio/mix lists as a single track", () => {
  // Auto-generated radio mixes (list=RD…) are not fixed playlists.
  expect(
    isPlaylistUrl("https://www.youtube.com/watch?v=abc&list=RD123"),
  ).toBe(false);
  expect(
    isPlaylistUrl("https://www.youtube.com/watch?v=abc&start_radio=1"),
  ).toBe(false);
});

test("isPlaylistUrl is false for a plain video URL", () => {
  expect(isPlaylistUrl("https://www.youtube.com/watch?v=abc")).toBe(false);
  expect(isPlaylistUrl("https://youtu.be/abc")).toBe(false);
});
