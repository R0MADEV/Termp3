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
  duration?: number; // seconds, when known
  artist?: string; // uploader/channel, when known
}

// Cache entries used to be plain title strings; now they hold duration + artist
// too. We still read the legacy string form for backward compatibility.
type CacheEntry = string | { title: string; duration?: number; artist?: string };
function entryTitle(e: CacheEntry | undefined): string | undefined {
  return typeof e === "string" ? e : e?.title;
}
function entryDuration(e: CacheEntry | undefined): number | undefined {
  return typeof e === "string" ? undefined : e?.duration;
}
function entryArtist(e: CacheEntry | undefined): string | undefined {
  return typeof e === "string" ? undefined : e?.artist;
}

export interface SearchResult {
  url: string;
  title: string;
  duration?: number;
  artist?: string;
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
const YT_URL_PREFIX = "https://www.youtube.com/watch?v=";
function parseEntries(stdout: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tab = line.indexOf("\t");
    const id = tab >= 0 ? line.slice(0, tab) : line;
    const title = tab >= 0 ? line.slice(tab + 1) : id;
    results.push({ url: YT_URL_PREFIX + id, title });
  }
  return results;
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

/** Fetches a single URL's title, duration and artist (no download). */
async function fetchMeta(
  url: string,
): Promise<{ title: string; duration: number; artist?: string } | null> {
  const out = await ytDlpStdout([
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "-O",
    "%(title)s\n%(duration)s\n%(uploader)s",
    url,
  ]);
  const [title, durRaw, uploader] = out.split(/\r?\n/);
  const t = title?.trim();
  if (!t) return null;
  const d = Number(durRaw?.trim());
  const a = uploader?.trim();
  return {
    title: t,
    duration: Number.isFinite(d) && d > 0 ? d : 0,
    artist: a && a !== "NA" ? a : undefined,
  };
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

function toTrack(url: string, cache: Record<string, CacheEntry>): Track {
  if (isLocalFile(url)) return { url, title: basename(url), resolved: true };
  const title = entryTitle(cache[url]);
  if (title)
    return {
      url,
      title,
      resolved: true,
      duration: entryDuration(cache[url]),
      artist: entryArtist(cache[url]),
    };
  return { url, title: url, resolved: false };
}

/** Reads the active playlist → tracks with provisional titles. */
export function loadPlaylist(): Track[] {
  const cache = loadCache();
  const tracks: Track[] = [];
  for (const raw of readFileSync(activeFile(), "utf8").split(/\r?\n/)) {
    const url = raw.trim();
    if (url && !url.startsWith("#")) tracks.push(toTrack(url, cache));
  }
  return tracks;
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
  const existing = new Set<string>();
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    existing.add(raw.trim());
  }
  if (existing.has(clean)) return { added: false, reason: "duplicate" };
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

// In-memory cache: avoids re-reading and re-parsing the JSON file on every
// call to loadCache(). Invalidated whenever saveCache() writes a new version.
let _cachedTitles: Record<string, CacheEntry> | null = null;

function loadCache(): Record<string, CacheEntry> {
  if (_cachedTitles) return _cachedTitles;
  if (!existsSync(TITLES_CACHE)) return (_cachedTitles = {});
  try {
    return (_cachedTitles = JSON.parse(readFileSync(TITLES_CACHE, "utf8")));
  } catch {
    return (_cachedTitles = {});
  }
}

function saveCache(cache: Record<string, CacheEntry>): void {
  _cachedTitles = cache;
  writeFileSync(TITLES_CACHE, JSON.stringify(cache));
}

/**
 * Drops cache entries for URLs that are no longer in ANY playlist, so the cache
 * can't grow forever. Safe: a URL still present in some playlist is kept, so
 * re-adding a removed track elsewhere still resolves instantly.
 */
export function pruneTitleCache(): void {
  ensureConfig();
  const cache = loadCache();
  const urls = Object.keys(cache);
  if (urls.length === 0) return;
  const used = new Set<string>();
  for (const name of listPlaylists()) {
    const file = playlistFile(name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const url = line.trim();
      if (url && !url.startsWith("#")) used.add(url);
    }
  }
  let changed = false;
  for (const url of urls) {
    if (!used.has(url)) {
      delete cache[url];
      changed = true;
    }
  }
  if (changed) saveCache(cache);
}

/** Stores known titles in the cache (e.g. from an import or a search). */
export function cacheTitles(items: { url: string; title: string }[]): void {
  const cache = loadCache();
  for (const it of items) if (it.url && it.title) cache[it.url] = it.title;
  saveCache(cache);
}

/**
 * Resolves titles only for the given indices (the visible window), in parallel
 * and bounded. Uses the cache first; persists new titles. Calls onUpdate as
 * each one resolves. Lazy on purpose — a 4,000-track list never resolves all
 * titles at once.
 */
export async function resolveTitlesAt(
  tracks: Track[],
  indices: number[],
  onUpdate: (index: number, track: Track) => void,
  concurrency = 4,
): Promise<void> {
  const cache = loadCache();
  // Needs work if the title, duration or artist was never fetched (legacy cache
  // stored titles only). Local files have no remote metadata to fetch.
  const needs = (tr: Track) =>
    !isLocalFile(tr.url) &&
    (!tr.resolved ||
      entryDuration(cache[tr.url]) === undefined ||
      entryArtist(cache[tr.url]) === undefined);
  const pending = indices.filter((i) => tracks[i] && needs(tracks[i]!));

  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const i = pending[cursor++]!;
      const tr = tracks[i];
      if (!tr) continue;
      const cached = cache[tr.url];
      const cachedTitle = entryTitle(cached);
      const cachedDur = entryDuration(cached);
      const cachedArtist = entryArtist(cached);
      // Reuse the cache only when title, duration AND artist are all present.
      const complete =
        cachedTitle && cachedDur !== undefined && cachedArtist !== undefined;
      const meta = complete
        ? { title: cachedTitle!, duration: cachedDur!, artist: cachedArtist! }
        : await fetchMeta(tr.url);
      if (!meta) continue;
      // "" is the sentinel for "fetched, but no artist" so we never refetch it.
      const artist = meta.artist ?? "";
      tr.title = meta.title;
      tr.duration = meta.duration;
      tr.artist = artist;
      tr.resolved = true;
      cache[tr.url] = { title: meta.title, duration: meta.duration, artist };
      onUpdate(i, tr);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, worker),
  );
  // Save once at the end instead of after every individual track resolve.
  if (pending.length > 0) saveCache(cache);
}
