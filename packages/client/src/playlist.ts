// Playlist management.
//
// Each named playlist is a file in playlists/ (one URL per line). Operations
// act on the ACTIVE playlist (stored in settings). YouTube titles are fetched
// with yt-dlp (no download) and cached on disk so the list loads instantly.

import { spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  appendFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  PLAYLISTS_DIR,
  DEFAULT_PLAYLIST_NAME,
  TITLES_CACHE,
  ensureConfig,
  loadSettings,
  saveSettings,
} from "./config.ts";
import { ytDlpCommand } from "./ytdlp.ts";

export interface Track {
  url: string;
  title: string;
  resolved: boolean; // true if the title is the real one (not a placeholder)
}

export interface SearchResult {
  url: string;
  title: string;
}

// --- yt-dlp (shared) ---

/** Runs yt-dlp with the given args and resolves its stdout ("" on error). */
function ytDlpStdout(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(ytDlpCommand(), args);
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", () => resolve(""));
    proc.on("close", () => resolve(out));
  });
}

/** Parses yt-dlp "%(id)s\t%(title)s" lines into results. */
function parseEntries(stdout: string): SearchResult[] {
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const id = tab >= 0 ? line.slice(0, tab) : line;
      const title = tab >= 0 ? line.slice(tab + 1) : id;
      return { url: `https://www.youtube.com/watch?v=${id}`, title };
    });
}

/** Searches YouTube and returns results (flat, no download). */
export async function searchYouTube(
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  const out = await ytDlpStdout([
    `ytsearch${limit}:${query}`,
    "--flat-playlist",
    "--no-warnings",
    "--print",
    "%(id)s\t%(title)s",
  ]);
  return parseEntries(out);
}

/**
 * True if a URL points to a real, importable playlist/album.
 * Radio/mix lists (list=RD…, &start_radio=1) are auto-generated infinite
 * mixes, not fixed playlists — treat those as a single track.
 */
export function isPlaylistUrl(url: string): boolean {
  if (/[?&]start_radio=1/.test(url)) return false;
  const m = url.match(/[?&]list=([^&]+)/);
  if (m) return !(m[1] ?? "").startsWith("RD");
  return /\/playlist\?/.test(url);
}

/** Expands a YouTube playlist URL into its name and entries. */
export async function fetchPlaylist(
  url: string,
  limit = 200,
): Promise<{ name: string; entries: SearchResult[] }> {
  const out = await ytDlpStdout([
    "--flat-playlist",
    "--no-warnings",
    "-I",
    `1:${limit}`,
    "--print",
    "%(id)s\t%(title)s",
    url,
  ]);
  const nameOut = await ytDlpStdout([
    "--flat-playlist",
    "--no-warnings",
    "-I",
    "1:1",
    "--print",
    "%(playlist_title)s",
    url,
  ]);
  // yt-dlp returns "NA" when a playlist has no title.
  const raw = nameOut.split(/\r?\n/)[0]?.trim();
  const name = !raw || raw === "NA" ? "YouTube playlist" : raw;
  return { name, entries: parseEntries(out) };
}

/** Fetches a single URL's title (no download). */
async function fetchTitle(url: string): Promise<string | null> {
  const out = await ytDlpStdout([
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "-O",
    "%(title)s",
    url,
  ]);
  return out.split(/\r?\n/)[0]?.trim() || null;
}

// --- named playlist files ---

function sanitizeName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 60);
  return clean || "Playlist";
}

function playlistFile(name: string): string {
  return join(PLAYLISTS_DIR, `${sanitizeName(name)}.txt`);
}

/** The active playlist's file, created empty if missing. */
function activeFile(): string {
  ensureConfig();
  const file = playlistFile(activePlaylist());
  if (!existsSync(file)) writeFileSync(file, "");
  return file;
}

export function activePlaylist(): string {
  return loadSettings().activePlaylist ?? DEFAULT_PLAYLIST_NAME;
}

export function setActivePlaylist(name: string): void {
  saveSettings({ activePlaylist: sanitizeName(name) });
}

/** Names of all saved playlists. */
export function listPlaylists(): string[] {
  ensureConfig();
  return readdirSync(PLAYLISTS_DIR)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.slice(0, -4))
    .sort();
}

/** Finds a free playlist name, adding " 2", " 3"… so nothing is overwritten. */
function uniquePlaylistName(name: string): string {
  const base = sanitizeName(name);
  if (!existsSync(playlistFile(base))) return base;
  let n = 2;
  while (existsSync(playlistFile(`${base} ${n}`))) n++;
  return `${base} ${n}`;
}

/** Deletes a named playlist file. */
export function removePlaylist(name: string): void {
  const file = playlistFile(name);
  if (existsSync(file)) rmSync(file);
}

/** Creates a new named playlist with the given URLs. Returns the name used. */
export function createPlaylist(name: string, urls: string[]): string {
  ensureConfig();
  const unique = uniquePlaylistName(name);
  writeFileSync(playlistFile(unique), `${urls.join("\n")}\n`);
  return unique;
}

// --- active playlist contents ---

function isLocalFile(url: string): boolean {
  return !/^(https?|rtmp|rtsp):\/\//i.test(url);
}

function toTrack(url: string, cache: Record<string, string>): Track {
  if (isLocalFile(url)) return { url, title: basename(url), resolved: true };
  const cached = cache[url];
  if (cached) return { url, title: cached, resolved: true };
  return { url, title: url, resolved: false };
}

/** Reads the active playlist → tracks with provisional titles. */
export function loadPlaylist(): Track[] {
  const cache = loadCache();
  return readFileSync(activeFile(), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((url) => url && !url.startsWith("#"))
    .map((url) => toTrack(url, cache));
}

/**
 * Appends a URL/path to the active playlist (avoids exact duplicates).
 * The reason is a code ("empty" | "duplicate") the caller can translate.
 */
export function addUrl(
  url: string,
): { added: boolean; reason?: "empty" | "duplicate" } {
  const clean = url.trim();
  if (!clean) return { added: false, reason: "empty" };
  const file = activeFile();
  const existing = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim());
  if (existing.includes(clean)) return { added: false, reason: "duplicate" };
  appendFileSync(file, `${clean}\n`);
  return { added: true };
}

/** Removes a URL/path from the active playlist. Returns true if it was found. */
export function removeUrl(url: string): boolean {
  const target = url.trim();
  const file = activeFile();
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const kept = lines.filter((l) => l.trim() !== target);
  if (kept.length === lines.length) return false;
  writeFileSync(file, kept.join("\n"));
  return true;
}

// --- title cache ---

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

/**
 * Resolves missing titles in parallel (bounded), updates the cache, and calls
 * onUpdate as each one resolves so the UI can refresh live.
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
  const worker = async () => {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      if (!item) break;
      const title = await fetchTitle(item.t.url);
      if (!title) continue;
      item.t.title = title;
      item.t.resolved = true;
      cache[item.t.url] = title;
      saveCache(cache);
      onUpdate(item.i, item.t);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, worker),
  );
}
