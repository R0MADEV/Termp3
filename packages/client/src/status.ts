// "Now playing" state in a file, for scriptable bars (tmux/zellij)
// or any external integration. The player writes it every second;
// `catunes status` reads it.
//
// This complements the terminal title (title.ts): the title covers
// ANY terminal automatically; the file caters to anyone who wants to
// render it in their own status bar.

import { writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { STATUS_FILE, ensureConfig } from "./config.ts";
import type { Player } from "./player.ts";
import { fmtTime } from "./fmt.ts";

/** Starts the periodic writing of the state to disk. */
export function startStatusBroadcast(player: Player, intervalMs = 1000) {
  ensureConfig();
  // Only write when the line actually changes, to reduce I/O.
  let lastLine = "";
  const write = () => {
    const s = player.state;
    if (!s.url) return;
    const icon = s.paused ? "⏸" : "▶";
    const title = (s.title ?? "").replace(/\s+/g, " ").slice(0, 45);
    const line = `${icon} ${title} ${fmtTime(s.position)}/${fmtTime(s.duration)}`;
    if (line === lastLine) return;
    lastLine = line;
    try {
      writeFileSync(STATUS_FILE, line);
    } catch {
      // if it can't be written, no big deal
    }
  };
  write();
  return setInterval(write, intervalMs);
}

/**
 * Reads the current state. If the file is "stale" (the player is no longer
 * writing), we return an empty string: nothing is playing.
 */
export function readStatus(maxAgeMs = 8000): string {
  if (!existsSync(STATUS_FILE)) return "";
  try {
    const st = statSync(STATUS_FILE);
    if (Date.now() - st.mtimeMs > maxAgeMs) return "";
    return readFileSync(STATUS_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

