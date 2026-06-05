// Command registry for catunes slash commands.
// Add new commands here: define the name, syntax, description and handler.
// They automatically appear in autocomplete and /help.

import type { Track } from "../../playlist.ts";
import type { Overlay } from "./overlay.ts";

export interface CommandCtx {
  setStatusMsg: (msg: string) => void;
  setActiveProvider: (p: "youtube" | "apple") => void;
  saveSettings: (s: Record<string, unknown>) => void;
  setOverlay: (o: Overlay) => void;
  setSel: (i: number) => void;
  setTracks: (t: Track[]) => void;
  setListIdx: (i: number) => void;
  activeProvider: "youtube" | "apple";
  player: { togglePause(): void };
  viewIdx: number[];
  current: number;
  tracks: Track[];
  execSearch: (q: string, p: "youtube" | "apple") => void;
  play: (i: number) => void;
  advance: (auto: boolean) => void;
  quit: () => void;
  openOverlay: (o: Overlay) => void;
}

export interface Command {
  name: string;
  syntax: string;
  desc: string;
  handler: (args: string) => Promise<void>;
}

export function createCommands(ctx: CommandCtx): Record<string, Command> {
  const ok = (msg: string) => ctx.setStatusMsg(`OK ${msg}`);
  const err = (msg: string) => ctx.setStatusMsg(`ERR ${msg}`);

  return {
    "/provider": {
      name: "/provider",
      syntax: "/provider [youtube|apple]",
      desc: "Switch music provider",
      handler: async (args) => {
        if (args === "apple" || args === "youtube") {
          ctx.setActiveProvider(args);
          ctx.saveSettings({ activeProvider: args });
          ok(`Provider: ${args}`);
        } else {
          err("Usage: /provider [apple|youtube]");
        }
      },
    },
    "/search": {
      name: "/search",
      syntax: "/search <query>",
      desc: "Search songs",
      handler: async (args) => {
        if (args) {
          await ctx.execSearch(args, ctx.activeProvider);
        } else {
          ctx.setSel(0);
          ctx.setOverlay({ kind: "searchProvider" });
        }
      },
    },
    "/auth": {
      name: "/auth",
      syntax: "/auth <cookies>",
      desc: "Set Apple Music session cookies",
      handler: async (args) => {
        if (!args) return err("Usage: /auth <cookies>");
        ctx.saveSettings({ appleCookies: args });
        const { resetAppleClient } = await import("../../apple.ts");
        resetAppleClient();
        ok("Apple Music cookies updated.");
      },
    },
    "/library": {
      name: "/library",
      syntax: "/library",
      desc: "Load Apple Music library",
      handler: async () => {
        try {
          ctx.setStatusMsg("AP Fetching Apple Music library...");
          const { getLibrarySongs } = await import("../../apple.ts");
          const libTracks = await getLibrarySongs();
          if (libTracks.length === 0) {
            err("Library is empty or cookies are invalid.");
          } else {
            ctx.setTracks(libTracks);
            ctx.setListIdx(0);
            ok(`Loaded ${libTracks.length} songs.`);
          }
        } catch (e) {
          err(`Failed to fetch library: ${String(e)}`);
        }
      },
    },
    "/play": {
      name: "/play",
      syntax: "/play <index>",
      desc: "Play track by index",
      handler: async (args) => {
        const idx = parseInt(args, 10);
        if (!isNaN(idx) && ctx.viewIdx[idx] != null) {
          ctx.play(ctx.viewIdx[idx]!);
        } else {
          err("Usage: /play <index>");
        }
      },
    },
    "/pause": {
      name: "/pause",
      syntax: "/pause",
      desc: "Pause / resume",
      handler: async () => { ctx.player.togglePause(); },
    },
    "/next": {
      name: "/next",
      syntax: "/next",
      desc: "Skip to next track",
      handler: async () => { ctx.advance(false); },
    },
    "/prev": {
      name: "/prev",
      syntax: "/prev",
      desc: "Go to previous track",
      handler: async () => {
        ctx.play((ctx.current - 1 + ctx.tracks.length) % (ctx.tracks.length || 1));
      },
    },
    "/quit": {
      name: "/quit",
      syntax: "/quit",
      desc: "Exit catunes",
      handler: async () => { ctx.quit(); },
    },
    "/exit": {
      name: "/exit",
      syntax: "/exit",
      desc: "Exit catunes",
      handler: async () => { ctx.quit(); },
    },
    "/help": {
      name: "/help",
      syntax: "/help",
      desc: "Show commands",
      handler: async () => { ctx.openOverlay({ kind: "help" }); },
    },
  };
}

/** Returns commands whose name starts with the given prefix (for autocomplete). */
export function matchCommands(prefix: string, cmds: Record<string, Command>): Command[] {
  return Object.values(cmds).filter((c) => c.name.startsWith(prefix));
}
