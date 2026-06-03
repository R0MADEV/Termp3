import { test, expect } from "bun:test";
import { assetForPlatform } from "./ytdlp.ts";

test("macOS uses the universal binary", () => {
  expect(assetForPlatform("darwin", "arm64").asset).toBe("yt-dlp_macos");
  expect(assetForPlatform("darwin", "x64").asset).toBe("yt-dlp_macos");
});

test("Windows uses the .exe", () => {
  expect(assetForPlatform("win32", "x64").asset).toBe("yt-dlp.exe");
});

test("Linux picks the right arch", () => {
  expect(assetForPlatform("linux", "x64").asset).toBe("yt-dlp_linux");
  expect(assetForPlatform("linux", "arm64").asset).toBe("yt-dlp_linux_aarch64");
});
