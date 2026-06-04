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
  // Resume: last track + position within the last playlist.
  lastPlaylist?: string;
  lastUrl?: string;
  lastPos?: number;
}

/** Reads persisted user settings (empty object if none). */
export function loadSettings(): Settings {
  if (!existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** Persists user settings (merges with existing). */
export function saveSettings(patch: Settings): void {
  ensureConfig();
  const merged = { ...loadSettings(), ...patch };
  writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
}
