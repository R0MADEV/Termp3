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
import { PLAYLIST_FILE, loadSettings } from "./config.ts";
import { PlayerUI } from "./ui/player.ts";
import { MiniUI } from "./ui/mini.ts";
import { startTitleBroadcast } from "./title.ts";
import { startStatusBroadcast, readStatus } from "./status.ts";
import { startControlServer, sendControl } from "./control.ts";
import { t, setLocale, SUPPORTED_LOCALES, type Locale } from "./i18n.ts";

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
  console.log(t("help.body", { version: VERSION, playlist: PLAYLIST_FILE }));
}

async function launchUI() {
  const mpv = checkMpv();
  if (!mpv.found) {
    console.error(t("err.mpvMissing", { hint: installHint("mpv") }));
    process.exit(1);
  }
  const tracks = loadPlaylist();
  if (tracks.length === 0) {
    console.log(t("playlist.empty", { file: PLAYLIST_FILE }));
    process.exit(0);
  }

  const player = new Player(mpv.path ?? "mpv");
  await player.start();

  const ui = new PlayerUI(player, tracks);
  ui.start();

  // "Now playing" visible in any terminal (title) and in tmux/zellij bars (file).
  startTitleBroadcast(player);
  startStatusBroadcast(player);
  // Control from another tab: termp3 pause/next/prev/vol.
  startControlServer({
    pause: () => ui.controlPause(),
    next: () => ui.controlNext(),
    prev: () => ui.controlPrev(),
    volume: (d) => ui.controlVolume(d),
  });

  // Resolve any missing titles in the background and refresh the UI.
  resolveTitles(tracks, (i, t) => ui.updateTrack(i, t)).catch(() => {});
}

async function launchMini(position: "top" | "bottom") {
  const mpv = checkMpv();
  if (!mpv.found) {
    console.error(t("err.mpvMissing", { hint: installHint("mpv") }));
    process.exit(1);
  }
  const tracks = loadPlaylist();
  if (tracks.length === 0) {
    console.log(t("playlist.empty", { file: PLAYLIST_FILE }));
    process.exit(0);
  }

  const player = new Player(mpv.path ?? "mpv");
  await player.start();

  const ui = new MiniUI(player, tracks, position);
  ui.start();

  startTitleBroadcast(player);
  startStatusBroadcast(player);
  startControlServer({
    pause: () => ui.controlPause(),
    next: () => ui.controlNext(),
    prev: () => ui.controlPrev(),
    volume: (d) => ui.controlVolume(d),
  });

  // Resolve titles in the background (improves the strip's text).
  resolveTitles(tracks, () => {}).catch(() => {});
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
      : t("doctor.ytMissing", { hint: installHint("yt-dlp") }),
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
  const yt = checkYtDlp();
  if (/youtu\.?be/.test(url) && !yt.found) {
    console.error(t("err.ytdlpYoutube", { hint: installHint("yt-dlp") }));
    process.exit(1);
  }

  const player = new Player(mpv.path ?? "mpv");
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
const [, , cmd, arg] = process.argv;

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
  case "doctor":
    doctor();
    break;
  case undefined:
    await launchUI();
    break;
  case "--mini":
  case "mini":
    await launchMini(arg === "top" ? "top" : "bottom");
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
