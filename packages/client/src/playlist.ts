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
  statSync,
  rmSync,
} from "node:fs";
import { basename, join, extname } from "node:path";
import { homedir } from "node:os";
import { parseFile } from "music-metadata";
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

// --- favorites (a special auto-managed playlist) ---

export const FAVORITES_NAME = "★ Favorites";

/** The set of favorited URLs (empty if there are none). */
export function favoriteUrls(): Set<string> {
  const file = playlistFile(FAVORITES_NAME);
  if (!existsSync(file)) return new Set();
  const urls = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((u) => u && !u.startsWith("#"));
  return new Set(urls);
}

/** Removes a URL from favorites if present (idempotent). */
export function removeFavorite(url: string): void {
  const favs = favoriteUrls();
  if (!favs.has(url)) return;
  favs.delete(url);
  const file = playlistFile(FAVORITES_NAME);
  if (favs.size === 0) {
    if (existsSync(file)) rmSync(file);
  } else {
    writeFileSync(file, `${[...favs].join("\n")}\n`);
  }
}

/** Adds/removes a URL from favorites. Returns the new state (true = favorited). */
export function toggleFavorite(url: string): boolean {
  ensureConfig();
  const favs = favoriteUrls();
  const now = !favs.has(url);
  if (now) favs.add(url);
  else favs.delete(url);
  const file = playlistFile(FAVORITES_NAME);
  if (favs.size === 0) {
    if (existsSync(file)) rmSync(file);
  } else {
    writeFileSync(file, `${[...favs].join("\n")}\n`);
  }
  return now;
}

// --- active playlist contents ---

function isLocalFile(url: string): boolean {
  return !/^(https?|rtmp|rtsp):\/\//i.test(url);
}

const AUDIO_EXT = new Set([
  ".mp3", ".m4a", ".m4b", ".flac", ".wav", ".ogg", ".opus",
  ".aac", ".wma", ".aiff", ".aif", ".alac", ".webm", ".mka",
]);

/**
 * Expands a path: a folder → all audio files inside (recursive); a file → itself;
 * a URL → unchanged. Lets the user add a whole music folder at once.
 */
export function expandAudioPath(input: string): string[] {
  let p = input.trim().replace(/^["']|["']$/g, ""); // strip surrounding quotes
  if (!p || /^(https?|rtmp|rtsp):\/\//i.test(p)) return p ? [p] : [];
  // Expand a leading "~" to the home directory (the shell doesn't do it here).
  if (p === "~" || p.startsWith("~/")) p = join(homedir(), p.slice(1));
  let st;
  try {
    st = statSync(p);
  } catch {
    return [p]; // not a real path → pass through (mpv will report it)
  }
  if (!st.isDirectory()) return [p];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (AUDIO_EXT.has(extname(e.name).toLowerCase())) out.push(full);
    }
  };
  walk(p);
  return out.sort();
}

/** Reads a local file's ID3/metadata tags (title, artist, duration). */
async function readLocalMeta(
  path: string,
): Promise<{ title: string; duration: number; artist?: string } | null> {
  try {
    const m = await parseFile(path, { duration: true });
    const t = m.common.title?.trim();
    const a = m.common.artist?.trim();
    const title = t ? (a ? `${a} - ${t}` : t) : basename(path);
    const d = Math.round(m.format.duration ?? 0);
    return { title, duration: d > 0 ? d : 0, artist: a || undefined };
  } catch {
    return { title: basename(path), duration: 0 };
  }
}

function toTrack(url: string, cache: Record<string, CacheEntry>): Track {
  const title = entryTitle(cache[url]);
  if (title)
    return {
      url,
      title,
      resolved: true,
      duration: entryDuration(cache[url]),
      artist: entryArtist(cache[url]),
    };
  // Local files show the filename until their ID3 tags are read (lazily).
  if (isLocalFile(url)) return { url, title: basename(url), resolved: false };
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

function loadCache(): Record<string, CacheEntry> {
  if (!existsSync(TITLES_CACHE)) return {};
  try {
    return JSON.parse(readFileSync(TITLES_CACHE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, CacheEntry>): void {
  writeFileSync(TITLES_CACHE, JSON.stringify(cache, null, 2));
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

/** Caches a radio station's friendly name + label so it shows nicely and is
 *  treated as fully resolved (no yt-dlp lookups on a raw stream URL). */
export function cacheStation(url: string, name: string, label: string): void {
  const cache = loadCache();
  cache[url] = { title: name, duration: 0, artist: label };
  saveCache(cache);
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
  // Needs work if the title, duration or artist was never resolved. Local files
  // get their ID3 tags read once; remote tracks are looked up via yt-dlp.
  const needs = (tr: Track) => {
    if (isLocalFile(tr.url)) return !tr.resolved;
    return (
      !tr.resolved ||
      entryDuration(cache[tr.url]) === undefined ||
      entryArtist(cache[tr.url]) === undefined
    );
  };
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
        : isLocalFile(tr.url)
          ? await readLocalMeta(tr.url)
          : await fetchMeta(tr.url);
      if (!meta) continue;
      // "" is the sentinel for "fetched, but no artist" so we never refetch it.
      const artist = meta.artist ?? "";
      tr.title = meta.title;
      tr.duration = meta.duration;
      tr.artist = artist;
      tr.resolved = true;
      cache[tr.url] = { title: meta.title, duration: meta.duration, artist };
      saveCache(cache);
      onUpdate(i, tr);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, pending.length) }, worker),
  );
}
