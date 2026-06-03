// Playlist management: read URLs/files and resolve their titles.
//
// YouTube titles are fetched with yt-dlp (without downloading anything) and
// CACHED on disk, so that the second time the list loads instantly.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { basename } from "node:path";
import { PLAYLIST_FILE, TITLES_CACHE, ensureConfig } from "./config.ts";

export interface Track {
  url: string;
  title: string;
  resolved: boolean; // true if the title is the real one (not a placeholder)
}

function isLocalFile(url: string): boolean {
  return !/^(https?|rtmp|rtsp):\/\//i.test(url);
}

/**
 * Appends a URL/path to the end of playlist.txt (avoids exact duplicates).
 * The reason is a code ("empty" | "duplicate") the caller can translate.
 */
export function addUrl(
  url: string,
): { added: boolean; reason?: "empty" | "duplicate" } {
  ensureConfig();
  const clean = url.trim();
  if (!clean) return { added: false, reason: "empty" };
  const existing = readFileSync(PLAYLIST_FILE, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim());
  if (existing.includes(clean)) return { added: false, reason: "duplicate" };
  appendFileSync(PLAYLIST_FILE, `${clean}\n`);
  return { added: true };
}

/** Reads playlist.txt → list of tracks with provisional titles. */
export function loadPlaylist(): Track[] {
  ensureConfig();
  const lines = readFileSync(PLAYLIST_FILE, "utf8").split(/\r?\n/);
  const cache = loadCache();
  const tracks: Track[] = [];
  for (const raw of lines) {
    const url = raw.trim();
    if (!url || url.startsWith("#")) continue;
    if (isLocalFile(url)) {
      tracks.push({ url, title: basename(url), resolved: true });
    } else if (cache[url]) {
      tracks.push({ url, title: cache[url]!, resolved: true });
    } else {
      tracks.push({ url, title: url, resolved: false });
    }
  }
  return tracks;
}

function loadCache(): Record<string, string> {
  if (!existsSync(TITLES_CACHE)) return {};
  try {
    return JSON.parse(readFileSync(TITLES_CACHE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, string>): void {
  writeFileSync(TITLES_CACHE, JSON.stringify(cache, null, 2));
}

/** Fetches a URL's title with yt-dlp (a single request, no download). */
function fetchTitle(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", [
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      "-O",
      "%(title)s",
      url,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", () => resolve(null));
    proc.on("close", (code) => {
      const title = out.split(/\r?\n/)[0]?.trim();
      resolve(code === 0 && title ? title : null);
    });
  });
}

/**
 * Resolves the missing titles in parallel (with a concurrency limit),
 * updates the cache and calls onUpdate each time one is resolved to
 * refresh the UI live.
 */
export async function resolveTitles(
  tracks: Track[],
  onUpdate: (index: number, track: Track) => void,
  concurrency = 4,
): Promise<void> {
  const cache = loadCache();
  const pending = tracks
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !t.resolved);

  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      if (!item) break;
      const title = await fetchTitle(item.t.url);
      if (title) {
        item.t.title = title;
        item.t.resolved = true;
        cache[item.t.url] = title;
        saveCache(cache);
        onUpdate(item.i, item.t);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, worker),
  );
}
