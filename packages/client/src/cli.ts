#!/usr/bin/env node
// Entry point for termp3.
//
// Phase 0/1: player in SOLO mode. Plays a URL (YouTube, radio,
// local file) with keyboard controls and a progress bar.
// Synchronized rooms (optional WebSocket mode) come later,
// as a layer on top of this same core.

import { checkMpv, checkYtDlp, installHint } from "./deps.ts";
import { Player } from "./player.ts";
import { loadPlaylist, resolveTitles, addUrl } from "./playlist.ts";
import { PLAYLISTS_DIR, loadSettings, saveSettings } from "./config.ts";
import { runInkUI, controlBus } from "./ui/ink/app.tsx";
import { AudioAnalyzer } from "./audio.ts";
import { startTitleBroadcast } from "./title.ts";
import { startStatusBroadcast, readStatus } from "./status.ts";
import { startControlServer, sendControl } from "./control.ts";
import {
  ensureYtDlp,
  findYtDlp,
  hasDownloadedYtDlp,
  downloadedSizeMB,
  assetForPlatform,
} from "./ytdlp.ts";
import { t, setLocale, SUPPORTED_LOCALES, type Locale } from "./i18n.ts";

/** Ensures yt-dlp is available if the playlist has any remote (streamed) URL. */
async function ensureYtDlpForTracks(tracks: { url: string }[]): Promise<void> {
  const hasRemote = tracks.some((t) => /^https?:\/\//i.test(t.url));
  if (hasRemote) await ensureYtDlp((m) => console.log(m));
}

const VERSION = "0.0.1";

// Apply the saved language (an explicit TERMP3_LANG env var still wins).
{
  const saved = loadSettings().lang;
  if (
    !process.env.TERMP3_LANG &&
    saved &&
    (SUPPORTED_LOCALES as string[]).includes(saved)
  ) {
    setLocale(saved as Locale);
  }
}

function help() {
  console.log(t("help.body", { version: VERSION, playlist: PLAYLISTS_DIR }));
}

async function launchUI() {
  const mpv = checkMpv();
  if (!mpv.found) {
    console.error(t("err.mpvMissing", { hint: installHint("mpv") }));
    process.exit(1);
  }
  // Open even with an empty playlist: the user can press "/" to search or
  // "a" to add tracks from inside the interface.
  const tracks = loadPlaylist();

  await ensureYtDlpForTracks(tracks);

  const player = new Player(mpv.path ?? "mpv", loadSettings().volume ?? 100);
  await player.start();

  // "Now playing" visible in any terminal (title) and in tmux/zellij bars (file).
  startTitleBroadcast(player);
  startStatusBroadcast(player);
  // Control from another tab → forwarded to the Ink UI via the command bus.
  startControlServer({
    pause: () => controlBus.emit("pause"),
    next: () => controlBus.emit("next"),
    prev: () => controlBus.emit("prev"),
    volume: (d) => controlBus.emit("volume", d),
  });

  // Ink UI with the real-time audio analyzer (FFT visualizer).
  runInkUI(player, tracks, new AudioAnalyzer());
}

function doctor() {
  const mpv = checkMpv();
  const yt = checkYtDlp();
  console.log(t("doctor.header"));

  console.log(
    mpv.found
      ? t("doctor.mpvOk", { version: mpv.version ?? "" })
      : t("doctor.mpvMissing", { hint: installHint("mpv") }),
  );
  console.log(
    yt.found
      ? t("doctor.ytOk", { version: yt.version ?? "" })
      : hasDownloadedYtDlp()
        ? t("doctor.ytDownloaded", { size: downloadedSizeMB() })
        : t("doctor.ytAuto", { asset: assetForPlatform().asset }),
  );
  console.log(mpv.found ? t("doctor.ready") : t("doctor.needMpv"));
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function progressBar(pos: number, dur: number, width = 30): string {
  const ratio = dur > 0 ? Math.min(1, pos / dur) : 0;
  const filled = Math.round(ratio * width);
  return "─".repeat(filled) + "●" + "─".repeat(Math.max(0, width - filled));
}

async function play(url: string) {
  const mpv = checkMpv();
  if (!mpv.found) {
    console.error(t("err.mpvMissing", { hint: installHint("mpv") }));
    process.exit(1);
  }
  if (/^https?:\/\//i.test(url)) {
    const yt = await ensureYtDlp((m) => console.log(m));
    if (!yt && /youtu\.?be/.test(url)) {
      console.error(t("err.ytdlpYoutube", { hint: installHint("yt-dlp") }));
      process.exit(1);
    }
  }

  const player = new Player(mpv.path ?? "mpv", loadSettings().volume ?? 100);
  await player.start();
  player.load(url);

  // Render the "now playing" on a single line, refreshed.
  const render = () => {
    const s = player.state;
    const line =
      `\r▶ ${(s.title ?? url).slice(0, 50).padEnd(50)} ` +
      `${progressBar(s.position, s.duration)} ` +
      `${fmtTime(s.position)}/${fmtTime(s.duration)} ` +
      `🔊${s.volume}%  ${s.paused ? "⏸ " : "  "}`;
    process.stdout.write(line);
  };
  const timer = setInterval(render, 500);

  // Keyboard controls (raw mode to capture individual keystrokes).
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const quit = () => {
    clearInterval(timer);
    player.quit();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write(t("play.goodbye"));
    process.exit(0);
  };

  process.stdin.on("data", (key: string) => {
    switch (key) {
      case " ":
        player.togglePause();
        break;
      case "[C": // right arrow
        player.seek(5);
        break;
      case "[D": // left arrow
        player.seek(-5);
        break;
      case "+":
      case "=":
        player.setVolume(player.state.volume + 5);
        break;
      case "-":
        player.setVolume(player.state.volume - 5);
        break;
      case "q":
      case "": // Ctrl+C
        quit();
        break;
    }
  });

  player.on("exit", quit);
}

// --- argument routing ---
const [, , cmd, arg, arg2] = process.argv;

switch (cmd) {
  case "play":
    if (!arg) {
      console.error(t("err.missingUrlPlay"));
      process.exit(1);
    }
    await play(arg);
    break;
  case "add": {
    if (!arg) {
      console.error(t("err.missingUrlAdd"));
      process.exit(1);
    }
    const res = addUrl(arg);
    console.log(
      res.added
        ? t("add.ok", { url: arg })
        : t("add.skip", { reason: t(`reason.${res.reason}`) }),
    );
    break;
  }
  case "pause":
  case "next":
  case "prev": {
    const ok = await sendControl({ cmd });
    if (!ok) {
      console.error(t("ctl.noPlayer"));
      process.exit(1);
    }
    break;
  }
  case "vol": {
    // termp3 vol +5  |  termp3 vol -5
    const delta = arg ? Number(arg) : 0;
    if (!arg || Number.isNaN(delta)) {
      console.error(t("vol.usage"));
      process.exit(1);
    }
    const ok = await sendControl({ cmd: "vol", delta });
    if (!ok) {
      console.error(t("ctl.noPlayer"));
      process.exit(1);
    }
    break;
  }
  case "status":
    // Prints the "now playing" (for tmux/zellij bars). Empty if nothing is playing.
    console.log(readStatus());
    break;
  case "config": {
    const s = loadSettings();
    if (!arg) {
      console.log("termp3 settings:");
      console.log(`  lang        = ${s.lang ?? "(auto)"}`);
      console.log(`  searchLimit = ${s.searchLimit ?? 20}`);
      console.log("\nUsage: termp3 config <key> <value>  (keys: lang, searchLimit)");
      break;
    }
    if (arg2 === undefined) {
      console.error("Usage: termp3 config <key> <value>  (keys: lang, searchLimit)");
      process.exit(1);
    }
    if (arg === "lang") {
      if (!(SUPPORTED_LOCALES as string[]).includes(arg2)) {
        console.error(`Invalid lang. Supported: ${SUPPORTED_LOCALES.join(", ")}`);
        process.exit(1);
      }
      saveSettings({ lang: arg2 });
    } else if (arg === "searchLimit") {
      const n = Number(arg2);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        console.error("searchLimit must be an integer between 1 and 100.");
        process.exit(1);
      }
      saveSettings({ searchLimit: n });
    } else {
      console.error(`Unknown key: ${arg}  (keys: lang, searchLimit)`);
      process.exit(1);
    }
    console.log(`✅ ${arg} = ${arg2}`);
    break;
  }
  case "setup":
    // Detects the OS and downloads yt-dlp if needed, then shows status.
    await ensureYtDlp((m) => console.log(m));
    doctor();
    break;
  case "doctor":
    doctor();
    break;
  case undefined:
    await launchUI();
    break;
  case "--help":
  case "-h":
  case "help":
    help();
    break;
  default:
    console.error(t("err.unknownCmd", { cmd: String(cmd) }));
    help();
    process.exit(1);
}
