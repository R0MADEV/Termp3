// Updates the terminal TITLE with the "now playing" info.
//
// We use the standard OSC escape sequence (ESC ]0; ... BEL), which Warp, iTerm,
// kitty, etc. honor to set the tab/window title. This way the current
// track shows up in Warp's tab bar from any pane.
//
// (Independent of the TUI: writing the title doesn't touch the screen
//  contents, so it coexists with the UI without any issue.)

import type { Player } from "./player.ts";
import { fmtTime } from "./fmt.ts";

/** Sets the terminal title. */
export function setTerminalTitle(text: string): void {
  process.stdout.write(`\x1b]0;${text}\x07`);
}

/** Restores a neutral title. */
export function clearTerminalTitle(): void {
  setTerminalTitle("catunes");
}

/**
 * Starts the periodic update of the title with the current track.
 * Returns the timer in case you want to stop it.
 */
export function startTitleBroadcast(player: Player, intervalMs = 1000) {
  // Only write the escape sequence when the title string actually changes.
  let lastTitle = "";
  const update = () => {
    const s = player.state;
    if (!s.url) {
      if (lastTitle !== "catunes") {
        lastTitle = "catunes";
        setTerminalTitle("catunes");
      }
      return;
    }
    const icon = s.paused ? "⏸" : "♪";
    const title = (s.title ?? "").replace(/\s+/g, " ").slice(0, 45);
    const full = `${icon} ${title}  ${fmtTime(s.position)}`;
    if (full === lastTitle) return;
    lastTitle = full;
    setTerminalTitle(full);
  };

  update();
  const timer = setInterval(update, intervalMs);
  // On exit, we leave the title clean.
  process.on("exit", () => clearTerminalTitle());
  return timer;
}

