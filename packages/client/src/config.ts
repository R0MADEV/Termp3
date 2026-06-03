// termp3 configuration paths (cross-platform).

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";

export const CONFIG_DIR = join(homedir(), ".config", "termp3");
export const PLAYLIST_FILE = join(CONFIG_DIR, "playlist.txt");
export const TITLES_CACHE = join(CONFIG_DIR, "titles.json");
// User settings (language, etc.).
export const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");
// "Now playing" status for integration with tmux/zellij or other bars.
export const STATUS_FILE = join(CONFIG_DIR, "status.txt");
// Control socket: lets you drive the running player from another tab.
export const CONTROL_SOCKET =
  process.platform === "win32"
    ? "\\\\.\\pipe\\termp3-control"
    : join(CONFIG_DIR, "control.sock");

const DEFAULT_PLAYLIST = `# termp3 — playlist
# One URL (YouTube, radio, stream) or local file path per line.
# Lines starting with # are comments.

https://www.youtube.com/watch?v=dQw4w9WgXcQ
`;

/** Creates the config directory and a sample playlist if it doesn't exist. */
export function ensureConfig(): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(PLAYLIST_FILE)) writeFileSync(PLAYLIST_FILE, DEFAULT_PLAYLIST);
}

export interface Settings {
  lang?: string;
  searchLimit?: number;
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
