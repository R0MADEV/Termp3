// catunes configuration paths (cross-platform).

import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from "node:fs";

export const CONFIG_DIR = join(homedir(), ".config", "catunes");
// Legacy single playlist (migrated into playlists/Default.txt on first run).
export const PLAYLIST_FILE = join(CONFIG_DIR, "playlist.txt");
// One file per named playlist lives here.
export const PLAYLISTS_DIR = join(CONFIG_DIR, "playlists");
export const DEFAULT_PLAYLIST_NAME = "Default";
export const TITLES_CACHE = join(CONFIG_DIR, "titles.json");
// User settings (language, etc.).
export const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");
// Custom color themes (name -> { accent, spectrum }).
export const THEMES_FILE = join(CONFIG_DIR, "themes.json");
// "Now playing" status for integration with tmux/zellij or other bars.
export const STATUS_FILE = join(CONFIG_DIR, "status.txt");
// Control socket: lets you drive the running player from another tab.
export const CONTROL_SOCKET =
  process.platform === "win32"
    ? "\\\\.\\pipe\\catunes-control"
    : join(CONFIG_DIR, "control.sock");

const DEFAULT_PLAYLIST = `# catunes — playlist
# One URL (YouTube, radio, stream) or local file path per line.
# Lines starting with # are comments.

https://www.youtube.com/watch?v=dQw4w9WgXcQ
`;

// A few free, legal internet-radio streams (verified public Icecast streams,
// no account) so a fresh install isn't empty. Each has a friendly name shown in
// the UI. Add your own (incl. Spanish) with `a` or `catunes add "<url>"`.
const RADIO_STATIONS: { url: string; title: string; genre: string }[] = [
  { url: "https://stream.radioparadise.com/mp3-128", title: "Radio Paradise — Main Mix", genre: "📻 eclectic" },
  { url: "https://stream.radioparadise.com/rock-128", title: "Radio Paradise — Rock Mix", genre: "📻 rock" },
  { url: "https://stream.radioparadise.com/mellow-128", title: "Radio Paradise — Mellow Mix", genre: "📻 mellow" },
  { url: "https://stream.radioparadise.com/world-etc-128", title: "Radio Paradise — World/Etc", genre: "📻 world" },
  { url: "https://ice1.somafm.com/groovesalad-128-mp3", title: "SomaFM — Groove Salad", genre: "📻 downtempo" },
  { url: "https://ice1.somafm.com/indiepop-128-mp3", title: "SomaFM — Indie Pop Rocks", genre: "📻 indie pop" },
  { url: "https://ice1.somafm.com/u80s-128-mp3", title: "SomaFM — Underground 80s", genre: "📻 80s" },
  { url: "https://ice1.somafm.com/bootliquor-128-mp3", title: "SomaFM — Boot Liquor", genre: "📻 country" },
  { url: "https://ice1.somafm.com/dronezone-128-mp3", title: "SomaFM — Drone Zone", genre: "📻 ambient" },
];

const RADIOS_PLAYLIST =
  "# catunes — example radios (free public streams)\n" +
  RADIO_STATIONS.map((s) => s.url).join("\n") +
  "\n";

// Pre-fills the title cache with the radios' friendly names so they show nicely
// (instead of the raw stream URL). duration 0 / artist set = "fully resolved".
function seedRadioTitles(): void {
  let cache: Record<string, unknown> = {};
  if (existsSync(TITLES_CACHE)) {
    try {
      cache = JSON.parse(readFileSync(TITLES_CACHE, "utf8"));
    } catch {
      cache = {};
    }
  }
  // Always set: these are our curated names, so overwrite any earlier raw title.
  for (const s of RADIO_STATIONS) {
    cache[s.url] = { title: s.title, duration: 0, artist: s.genre };
  }
  writeFileSync(TITLES_CACHE, JSON.stringify(cache, null, 2));
}

/**
 * Creates the config + playlists directories and ensures a "Default" playlist
 * exists, migrating the legacy playlist.txt the first time.
 */
export function ensureConfig(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(PLAYLISTS_DIR)) mkdirSync(PLAYLISTS_DIR, { recursive: true });

  const defaultFile = join(PLAYLISTS_DIR, `${DEFAULT_PLAYLIST_NAME}.txt`);
  if (!existsSync(defaultFile)) {
    if (existsSync(PLAYLIST_FILE)) copyFileSync(PLAYLIST_FILE, defaultFile);
    else writeFileSync(defaultFile, DEFAULT_PLAYLIST);
  }

  // Seed a "Radios" example list (only if it doesn't exist) so there's always
  // something to play out of the box.
  const radiosFile = join(PLAYLISTS_DIR, "Radios.txt");
  if (!existsSync(radiosFile)) {
    writeFileSync(radiosFile, RADIOS_PLAYLIST);
    seedRadioTitles();
  }

  // Drop a sample custom theme so the format is discoverable.
  if (!existsSync(THEMES_FILE)) writeFileSync(THEMES_FILE, EXAMPLE_THEMES);
}

// Example custom themes file. accent = main color; spectrum = [low, mid, high].
// Colors are terminal names: green, yellow, red, cyan, blue, magenta, white…
const EXAMPLE_THEMES = `${JSON.stringify(
  { Ocean: { accent: "cyan", spectrum: ["blue", "cyan", "white"] } },
  null,
  2,
)}\n`;

export interface Settings {
  lang?: string;
  searchLimit?: number;
  volume?: number;
  activePlaylist?: string;
  theme?: string;
  vizMode?: string;
  eqGains?: number[];
  // Resume: last track + position within the last playlist.
  lastPlaylist?: string;
  lastUrl?: string;
  lastPos?: number;
  // Apple Music integration
  appleCookies?: string;
  activeProvider?: "youtube" | "apple";
}

// In-memory settings cache: avoids disk I/O on every loadSettings() call.
let _settingsCache: Settings | null = null;

/** Reads persisted user settings (empty object if none). */
export function loadSettings(): Settings {
  if (_settingsCache) return _settingsCache;
  if (!existsSync(SETTINGS_FILE)) {
    _settingsCache = {};
    return _settingsCache;
  }
  try {
    _settingsCache = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    _settingsCache = {};
  }
  return _settingsCache!;
}

/** Persists user settings (merges with existing). */
export function saveSettings(patch: Settings): void {
  ensureConfig();
  const merged = { ...loadSettings(), ...patch };
  writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  // Update the cache with the merged result so subsequent reads are instant.
  _settingsCache = merged;
}

