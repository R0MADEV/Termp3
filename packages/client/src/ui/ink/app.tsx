// Modern terminal UI built with Ink (React). The core (player, playlist,
// theme, i18n, ytdlp) is reused unchanged; this is only the presentation +
// input layer.

import React, { useState, useEffect, useRef } from "react";
import { EventEmitter } from "node:events";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";
import type { Player } from "../../player.ts";
import { EQ_BANDS } from "../../player.ts";
import {
  type Track,
  type SearchResult,
  loadPlaylist,
  listPlaylists,
  activePlaylist,
  setActivePlaylist,
  createPlaylist,
  removePlaylist,
  resolveTitlesAt,
  cacheTitles,
  cacheStation,
  addUrl,
  removeUrl,
  searchYouTube,
  isPlaylistUrl,
  fetchPlaylist,
  expandAudioPath,
} from "../../playlist.ts";
import { searchRadios, type RadioStation } from "../../radio.ts";
import {
  theme,
  listThemes,
  activeThemeName,
  setTheme,
} from "../../theme.ts";
import {
  t,
  setLocale,
  getLocale,
  SUPPORTED_LOCALES,
  LOCALE_NAMES,
  type Locale,
} from "../../i18n.ts";
import { loadSettings, saveSettings } from "../../config.ts";
import { ensureYtDlp } from "../../ytdlp.ts";
import { AudioAnalyzer, BANDS, WAVE_POINTS } from "../../audio.ts";

const SIDEBAR_W = 24;
const SPECTRUM_H = 6;
const SPECTRUM_COLS = BANDS;
const SEARCH_PRESETS = [10, 20, 30, 50, 100];

// 10-band equalizer presets (dB per band: 31Hz … 16kHz).
const EQ_PRESETS: { name: string; gains: number[] }[] = [
  { name: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: "Bass Boost", gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0] },
  { name: "Treble", gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7] },
  { name: "Vocal", gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] },
  { name: "Rock", gains: [5, 4, 2, 0, -1, -1, 1, 3, 4, 5] },
  { name: "Jazz", gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { name: "Classical", gains: [4, 3, 2, 0, 0, 0, -1, -1, 2, 3] },
  { name: "Loudness", gains: [6, 4, 0, 0, -2, 0, 0, 2, 5, 6] },
];
const EQ_LABELS = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];

/** Command bus so `catunes pause/next/...` (another tab) can drive the UI. */
export const controlBus = new EventEmitter();

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function bar(ratio: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

/** Scrolls a string that doesn't fit (Winamp-style marquee); static if it fits. */
function marquee(s: string, width: number, frame: number): string {
  if (s.length <= width) return s;
  const full = s + "   •   ";
  const off = Math.floor(frame / 3) % full.length;
  return (full + full).slice(off, off + width);
}

/** Strips playlist/radio params so only the single video is added. */
function singleVideoUrl(url: string): string {
  const m = url.match(/[?&]v=([^&]+)/);
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : url;
}

function useTermSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    cols: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  });
  useEffect(() => {
    const on = () =>
      setSize({ cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    stdout.on("resize", on);
    return () => {
      stdout.off("resize", on);
    };
  }, [stdout]);
  return size;
}

// --- presentational pieces ---

export const VIZ_MODES = ["bars", "mirror", "smooth", "scope", "plasma"] as const;
const LEVELS = "▁▂▃▄▅▆▇█";

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Colour columns by frequency: bass (left) → treble (right) across the theme's
// low/mid/high spectrum colours — a gradient instead of one flat colour.
function bandColor(i: number): string {
  const [low, mid, high] = theme().spectrum;
  return i < SPECTRUM_COLS / 3 ? low! : i < (2 * SPECTRUM_COLS) / 3 ? mid! : high!;
}

function vizBars(spec: number[], peaks: number[]): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  for (let level = SPECTRUM_H - 1; level >= 0; level--) {
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < SPECTRUM_COLS; i++) {
      const filled = (spec[i] ?? 0) > level;
      const cap = !filled && Math.floor(peaks[i] ?? 0) === level && (peaks[i] ?? 0) > 0.3;
      cells.push(
        <Text key={i} color={bandColor(i)} dimColor={cap}>
          {filled ? "█" : cap ? "▀" : " "}
        </Text>,
      );
    }
    rows.push(<Box key={level}>{cells}</Box>);
  }
  return rows;
}

function vizSmooth(spec: number[], peaks: number[]): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  for (let level = SPECTRUM_H - 1; level >= 0; level--) {
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < SPECTRUM_COLS; i++) {
      const h = spec[i] ?? 0;
      const cap = h <= level && Math.floor(peaks[i] ?? 0) === level && (peaks[i] ?? 0) > 0.3;
      const ch =
        h >= level + 1
          ? "█"
          : h > level
            ? LEVELS[Math.min(7, Math.floor((h - level) * 8))]
            : cap
              ? "▀"
              : " ";
      cells.push(
        <Text key={i} color={bandColor(i)} dimColor={cap}>
          {ch}
        </Text>,
      );
    }
    rows.push(<Box key={level}>{cells}</Box>);
  }
  return rows;
}

function vizMirror(spec: number[]): React.ReactNode[] {
  const [low, mid, high] = theme().spectrum;
  const cy = (SPECTRUM_H - 1) / 2;
  const rows: React.ReactNode[] = [];
  for (let r = 0; r < SPECTRUM_H; r++) {
    const dist = Math.abs(r - cy);
    const color = dist >= 2.5 ? high : dist >= 1 ? mid : low;
    let line = "";
    for (let i = 0; i < SPECTRUM_COLS; i++) {
      const half = ((spec[i] ?? 0) / SPECTRUM_H) * (SPECTRUM_H / 2) + 0.3;
      line += dist <= half ? "█" : " ";
    }
    rows.push(<Text key={r} color={color}>{line}</Text>);
  }
  return rows;
}

function vizScope(wave: number[]): React.ReactNode[] {
  const accent = theme().accent;
  const grid: string[][] = Array.from({ length: SPECTRUM_H }, () =>
    Array(SPECTRUM_COLS).fill(" "),
  );
  for (let x = 0; x < SPECTRUM_COLS; x++) {
    const v = wave[Math.floor((x / SPECTRUM_COLS) * wave.length)] ?? 0;
    const row = Math.max(
      0,
      Math.min(SPECTRUM_H - 1, Math.round((1 - (v + 1) / 2) * (SPECTRUM_H - 1))),
    );
    grid[row]![x] = "●";
  }
  return grid.map((cells, r) => (
    <Text key={r} color={accent}>{cells.join("")}</Text>
  ));
}

function vizPlasma(frame: number, energy: number): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  for (let r = 0; r < SPECTRUM_H; r++) {
    const spans: React.ReactNode[] = [];
    for (let x = 0; x < SPECTRUM_COLS; x++) {
      const v =
        Math.sin(x * 0.3 + frame * 0.15) +
        Math.sin(r * 0.6 + frame * 0.1) +
        Math.sin((x + r) * 0.2 + frame * 0.2);
      const hue = (((v + 3) / 6) * 360 + frame * 3) % 360;
      const color = hslToHex(hue, 85, 30 + energy * 45);
      spans.push(<Text key={x} color={color}>█</Text>);
    }
    rows.push(<Box key={r}>{spans}</Box>);
  }
  return rows;
}

function Visualizer({
  mode,
  spec,
  peaks,
  wave,
  frame,
  playing,
}: {
  mode: string;
  spec: number[];
  peaks: number[];
  wave: number[];
  frame: number;
  playing: boolean;
}) {
  let rows: React.ReactNode[];
  if (mode === "mirror") rows = vizMirror(spec);
  else if (mode === "smooth") rows = vizSmooth(spec, peaks);
  else if (mode === "scope") rows = vizScope(wave);
  else if (mode === "plasma") {
    const energy = spec.reduce((a, b) => a + b, 0) / (spec.length * SPECTRUM_H);
    rows = vizPlasma(frame, playing ? Math.max(0.15, energy) : 0.1);
  } else rows = vizBars(spec, peaks);
  return <Box flexDirection="column">{rows}</Box>;
}

// --- Cat mascot (ᓚᘏᗢ) ---
// Pacing cat used as a loading spinner; constant width so nothing jitters.
const CAT_WALK = ["ᓚᘏᗢ   ", " ᓚᘏᗢ  ", "  ᓚᘏᗢ ", "   ᓚᘏᗢ", "  ᓚᘏᗢ ", " ᓚᘏᗢ  "];

/** Mascot reflecting the player state; while playing the notes grow with the bass. */
function catMascot(playing: boolean, paused: boolean, beat: number): string {
  if (paused) return "ᓚᘏᗢ  zZ";
  if (!playing) return "ᓚᘏᗢ";
  const notes = (beat > 0.66 ? "♫♪♫" : beat > 0.33 ? "♪♫" : "♪").padEnd(3, " ");
  return `ᓚᘏᗢ ${notes}`;
}

// --- Cat mascot (top-right, themed) ---
// Block-art sitting cat with face, whiskers, arms and paws. The eyes react to
// the player state/beat (and wink/scare on actions); a progress "aura" ring
// fills clockwise around the cat as the track plays.
const CAT_ROWS = [
  "        ▄▀▄       ▄▀▄",
  "       █   ▀▄▄▄▄▄▀   █",
  null, // eye row (rendered with white eyeballs)
  " ───  █       ▄       █  ───",
  " ──    █    ▀▀▀▀▀    █   ──",
  "        ▀▄▄▄▄▄▄▄▄▄▄▄▀",
  "▄▄▄▄▄▄▄▄█   █   █   █▄▄▄▄▄▄▄▄",
  "        ▀▄▄▄▀   ▀▄▄▄▀",
] as const;
const CAT_W = 29;
const CAT_H = CAT_ROWS.length;

function PixelCat({
  mode,
  beat,
  frame,
  ratio,
  reaction,
  muted,
  shuffle,
  repeat,
}: {
  mode: "play" | "pause" | "stop";
  beat: number;
  frame: number;
  ratio: number;
  reaction: "wink" | "scared" | "meow" | null;
  muted: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
}) {
  const accent = theme().accent;
  const blink = frame % 28 < 2;
  const strong = mode === "play" && beat > 0.45; // a beat hit
  let pupil =
    beat > 0.5
      ? "●"
      : ((look) => (look === 1 ? "◗" : look === 3 ? "◖" : "●"))(
          Math.floor(frame / 7) % 4,
        );
  if (shuffle) pupil = "✦"; // excited on shuffle
  if (repeat === "one") pupil = "@"; // dizzy on repeat-one
  const base: "open" | "closed" | "wide" =
    blink || mode === "pause" || mode === "stop"
      ? "closed"
      : strong
        ? "wide"
        : "open";
  let left = base;
  let right = base;
  if (reaction === "wink") right = "closed";
  else if (reaction === "scared") left = right = "wide";

  // Animated, fixed-width body parts (so the aura frame never shifts).
  const ears = muted ? "╲█╱" : strong ? "▀▄▀" : "▄▀▄"; // dance / cover ears
  const mouth = strong ? "▄███▄" : "▀▀▀▀▀"; // sing on the beat
  const paw = frame % 55 < 3 ? "▄▀▀▀▄" : "▀▄▄▄▀"; // an occasional paw flick (~5s)
  const dyn: Record<number, string> = {
    0: `        ${ears}       ${ears}`,
    4: ` ──    █    ${mouth}    █   ──`,
    7: `        ${paw}   ${paw}`,
  };
  // Speech bubble above the cat (reserved line; constant presence).
  const cyc = (a: string[]) => a[Math.floor(frame / 5) % a.length]!;
  const bubble = muted
    ? "🙀 mute"
    : reaction === "meow"
      ? "meow!"
      : mode === "play"
        ? cyc(["  ♪  ", " ♪ ♫ ", " ♫ ♪ "])
        : cyc(["  z  ", " z Z ", "z Z z"]);
  const eye = (k: "open" | "closed" | "wide", key: string) =>
    k === "closed" ? (
      <Text key={key} color={accent}>
        ‿
      </Text>
    ) : (
      <Text key={key} color="#1b1b1b" backgroundColor="white">
        {k === "wide" ? "◉" : pupil}
      </Text>
    );

  // Progress aura: perimeter cells lit clockwise from the top-left corner.
  const total = 2 * CAT_W + 2 * CAT_H + 4;
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * total);
  const lit = (seq: number) => seq < filled;
  const hcell = (seq: number, key: number) => (
    <Text key={key} color={accent} dimColor={!lit(seq)}>
      {lit(seq) ? "━" : "─"}
    </Text>
  );
  const vcell = (seq: number) => (
    <Text color={accent} dimColor={!lit(seq)}>
      {lit(seq) ? "┃" : "│"}
    </Text>
  );
  const ccell = (seq: number, ch: string) => (
    <Text color={accent} dimColor={!lit(seq)}>
      {ch}
    </Text>
  );
  // Sequence indices (clockwise): TL=0, top 1..W, TR=W+1, right W+2..W+1+H,
  // BR=W+2+H, bottom (R→L), BL=2W+3+H, left (B→T).
  const rightSeq = (r: number) => CAT_W + 2 + r;
  const leftSeq = (r: number) => 2 * CAT_W + 4 + CAT_H + (CAT_H - 1 - r);
  const bottomSeq = (c: number) => CAT_W + 3 + CAT_H + (CAT_W - 1 - c);

  const inner = (r: number) => {
    if (r !== 2) {
      const s = dyn[r] ?? CAT_ROWS[r]!;
      return <Text color={accent}>{s.padEnd(CAT_W)}</Text>;
    }
    return (
      <>
        <Text color={accent}>{"      █  "}</Text>
        {eye(left, "l")}
        <Text color={accent}>{"         "}</Text>
        {eye(right, "r")}
        <Text color={accent}>{"  █      "}</Text>
      </>
    );
  };

  return (
    <Box flexDirection="column">
      <Box justifyContent="center">
        <Text color={accent} bold>
          {bubble}
        </Text>
      </Box>
      <Box>
        {ccell(0, "╭")}
        {Array.from({ length: CAT_W }, (_, c) => hcell(1 + c, c))}
        {ccell(CAT_W + 1, "╮")}
      </Box>
      {CAT_ROWS.map((_, r) => (
        <Box key={r}>
          {vcell(leftSeq(r))}
          {inner(r)}
          {vcell(rightSeq(r))}
        </Box>
      ))}
      <Box>
        {ccell(2 * CAT_W + 3 + CAT_H, "╰")}
        {Array.from({ length: CAT_W }, (_, c) => hcell(bottomSeq(c), c))}
        {ccell(CAT_W + 2 + CAT_H, "╯")}
      </Box>
    </Box>
  );
}

function NowPlaying({
  state,
  spec,
  peaks,
  wave,
  frame,
  mode,
  loading,
  shuffle,
  repeat,
  width,
  artist,
  trackTitle,
  reaction,
}: {
  state: Player["state"];
  spec: number[];
  peaks: number[];
  wave: number[];
  frame: number;
  mode: string;
  loading: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  trackTitle?: string;
  width: number;
  artist?: string;
  reaction: "wink" | "scared" | "meow" | null;
}) {
  const accent = theme().accent;
  const dur = fmtTime(state.duration);
  // Prefer mpv's live title (e.g. a radio's ICY "now playing"); if it's just the
  // stream URL (no metadata), fall back to the station/track name we cached.
  const live = state.title ?? "";
  const title =
    live && !/^https?:\/\//i.test(live)
      ? live
      : (trackTitle ?? state.url ?? t("ui.noSong"));
  const stateText = loading
    ? t("ui.loading")
    : state.paused
      ? `⏸  ${t("ui.state.pause")}`
      : state.url
        ? `▶  ${t("ui.state.play")}`
        : `■  ${t("ui.state.stop")}`;
  const repIcon = repeat === "one" ? "🔂" : "🔁";
  const ratio = state.duration > 0 ? state.position / state.duration : 0;
  const progW = Math.max(10, width - 56);
  const bass =
    spec.length >= 3 ? (spec[0]! + spec[1]! + spec[2]!) / (3 * SPECTRUM_H) : 0;
  const cat = loading
    ? CAT_WALK[frame % CAT_WALK.length]!
    : catMascot(!!state.url && !state.paused, state.paused, bass);
  const catMode: "play" | "pause" | "stop" = state.paused
    ? "pause"
    : state.url
      ? "play"
      : "stop";

  return (
    <Box borderStyle="round" borderColor={accent} flexDirection="row" paddingX={1}>
      <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between">
          <Text bold color={accent} wrap="truncate">
            ♫ {marquee(title, Math.max(10, width - 64), frame)}
          </Text>
          <Text>
            <Text color={shuffle ? accent : "gray"}>🔀 </Text>
            <Text color={repeat === "off" ? "gray" : accent}>{repIcon} </Text>
            <Text color={loading ? "yellow" : accent}>{stateText}</Text>
            <Text color={accent}>  {cat}</Text>
          </Text>
        </Box>
        <Text dimColor wrap="truncate">
          {artist ? `  🎙 ${artist}` : " "}
        </Text>
        <Box>
          <Visualizer
            mode={mode}
            spec={spec}
            peaks={peaks}
            wave={wave}
            frame={frame}
            playing={!!state.url && !state.paused}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={accent}>{bar(ratio, progW)}</Text>
          <Text dimColor>
            {" "}
            {Math.round(ratio * 100)}%  {fmtTime(state.position)} / {dur}
          </Text>
        </Box>
        <Box>
          <Text>{state.volume === 0 ? "🔇" : "🔊"} </Text>
          <Text color={accent}>{bar(state.volume / 100, 12)}</Text>
          <Text dimColor> {state.volume}%</Text>
        </Box>
      </Box>
      <Box
        flexShrink={0}
        marginLeft={2}
        alignItems="center"
        justifyContent="center"
      >
        <PixelCat
          mode={catMode}
          beat={bass}
          frame={frame}
          ratio={ratio}
          reaction={reaction}
          muted={state.volume === 0}
          shuffle={shuffle}
          repeat={repeat}
        />
      </Box>
    </Box>
  );
}

/**
 * Virtualized list panel: only the items that fit (maxVisible) are built and
 * rendered, windowed around the selection. Scrolling reveals new rows and
 * drops the off-screen ones — so a 4,000-track list costs the same as a tiny
 * one.
 */
function Panel({
  title,
  count,
  selected,
  focused,
  maxVisible,
  renderItem,
  emptyHint,
  width,
  flexGrow,
}: {
  title: string;
  count: number;
  selected: number;
  focused: boolean;
  maxVisible: number;
  renderItem: (index: number, highlighted: boolean) => React.ReactNode;
  emptyHint?: string;
  width?: number;
  flexGrow?: number;
}) {
  const accent = theme().accent;
  const max = maxVisible < count ? maxVisible : count;
  const start =
    max < count
      ? Math.max(0, Math.min(selected - Math.floor(max / 2), count - max))
      : 0;
  const rows: React.ReactNode[] = [];
  for (let i = start; i < start + max; i++) {
    rows.push(<Box key={i}>{renderItem(i, i === selected && focused)}</Box>);
  }
  // Scrollbar thumb: maps the window position onto the visible rows.
  const thumb =
    count > max ? Math.round((start / (count - max)) * (max - 1)) : -1;
  return (
    <Box
      borderStyle="round"
      borderColor={accent}
      borderDimColor={!focused}
      flexDirection="column"
      paddingX={1}
      width={width}
      flexGrow={flexGrow}
    >
      <Text bold color={accent} dimColor={!focused}>
        {title}
      </Text>
      {count === 0 && emptyHint ? (
        <Box flexDirection="column">
          <Text dimColor>ᓚᘏᗢ  zZ</Text>
          <Text dimColor>{emptyHint}</Text>
        </Box>
      ) : (
        <Box>
          <Box flexDirection="column" flexGrow={1}>
            {rows}
          </Box>
          {thumb >= 0 && (
            <Box flexDirection="column" marginLeft={1}>
              {Array.from({ length: max }, (_, r) => (
                <Text key={r} color={accent} dimColor={r !== thumb}>
                  {r === thumb ? "█" : "│"}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

/** Centered modal frame. */
function Modal({
  title,
  cols,
  rows,
  width,
  children,
}: {
  title: string;
  cols: number;
  rows: number;
  width?: number;
  children: React.ReactNode;
}) {
  const accent = theme().accent;
  return (
    <Box width={cols} height={rows} justifyContent="center" alignItems="center">
      <Box
        borderStyle="round"
        borderColor={accent}
        flexDirection="column"
        paddingX={2}
        paddingY={1}
        width={width ?? Math.min(cols - 4, 60)}
      >
        <Text bold color={accent}>
          {title}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

function PickList({
  options,
  selected,
  maxVisible,
}: {
  options: string[];
  selected: number;
  maxVisible?: number;
}) {
  const accent = theme().accent;
  const max = maxVisible && maxVisible < options.length ? maxVisible : options.length;
  const start =
    max < options.length
      ? Math.max(0, Math.min(selected - Math.floor(max / 2), options.length - max))
      : 0;
  const visible = options.slice(start, start + max);
  return (
    <Box flexDirection="column">
      {start > 0 && <Text dimColor> ▲ …</Text>}
      {visible.map((o, i) => {
        const idx = start + i;
        return (
          <Text
            key={idx}
            color={idx === selected ? accent : undefined}
            bold={idx === selected}
            wrap="truncate"
          >
            {idx === selected ? "› " : "  "}
            {o}
          </Text>
        );
      })}
      {start + max < options.length && <Text dimColor> ▼ …</Text>}
      <Box marginTop={1}>
        <Text dimColor>↑↓ · ↵ select · esc cancel</Text>
      </Box>
    </Box>
  );
}

type Overlay =
  | { kind: "none" }
  | { kind: "settings" }
  | { kind: "theme" }
  | { kind: "lang" }
  | { kind: "playlists" }
  | { kind: "searchLimit" }
  | { kind: "help" }
  | { kind: "eq" }
  | { kind: "searchInput" }
  | { kind: "radioInput" }
  | { kind: "addInput"; target: "track" | "list" }
  | { kind: "searchResults"; results: SearchResult[] }
  | { kind: "radioResults"; results: RadioStation[] }
  | { kind: "confirmTrack"; index: number }
  | { kind: "confirmPlaylist"; name: string }
  | { kind: "loading"; text: string };

function App({
  player,
  initialTracks,
  analyzer,
}: {
  player: Player;
  initialTracks: Track[];
  analyzer: AudioAnalyzer;
}) {
  const { exit } = useApp();
  const { cols, rows } = useTermSize();
  const accent = theme().accent;

  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [playlists, setPlaylists] = useState<string[]>(listPlaylists());
  const [focus, setFocus] = useState<"tracks" | "sidebar">("tracks");
  const [listIdx, setListIdx] = useState(0);
  const [sideIdx, setSideIdx] = useState(
    Math.max(0, listPlaylists().indexOf(activePlaylist())),
  );
  const [current, setCurrent] = useState(-1);
  const [state, setState] = useState({ ...player.state });
  const [spec, setSpec] = useState<number[]>(new Array(SPECTRUM_COLS).fill(0));
  const [peaks, setPeaks] = useState<number[]>(new Array(SPECTRUM_COLS).fill(0));
  const [wave, setWave] = useState<number[]>(new Array(WAVE_POINTS).fill(0));
  const [frame, setFrame] = useState(0);
  const [mode, setMode] = useState<string>(loadSettings().vizMode ?? "bars");
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("all");
  const [eq, setEq] = useState<number[]>(
    loadSettings().eqGains ?? new Array(EQ_BANDS.length).fill(0),
  );
  const [eqBand, setEqBand] = useState(0);
  const [mutedVol, setMutedVol] = useState<number | null>(null);
  const [filter, setFilter] = useState(""); // filter text for the current list
  const [filtering, setFiltering] = useState(false); // editing the filter

  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const [sel, setSel] = useState(0); // selection index inside list overlays
  const [input, setInput] = useState(""); // text-input overlays
  const [, bump] = useState(0); // force re-render after theme/lang change
  const prevPaused = useRef(false);
  const specRef = useRef<number[]>(new Array(SPECTRUM_COLS).fill(0));
  const smoothRef = useRef<number[]>(new Array(SPECTRUM_COLS).fill(0));
  const peakRef = useRef<number[]>(new Array(SPECTRUM_COLS).fill(0));
  const errRef = useRef(0); // consecutive failed tracks (stop if all unavailable)
  const waveRef = useRef<number[]>(new Array(WAVE_POINTS).fill(0));
  const inflight = useRef(new Set<string>()); // URLs whose title is resolving
  // Transient cat reaction (wink/scared); cleared once the deadline frame passes.
  const reactRef = useRef<{ type: "wink" | "scared" | "meow"; until: number }>({
    type: "wink",
    until: 0,
  });
  const react = (type: "wink" | "scared" | "meow") => {
    reactRef.current = { type, until: frame + 10 }; // ~0.9s
  };
  // Rows available for list items (NowPlaying ~13 + status + borders/title).
  const panelMax = Math.max(3, rows - 19);
  // Filtered view: indices into `tracks` that match the filter (all if none).
  const filt = filter.trim().toLowerCase();
  const viewIdx = filt
    ? tracks.reduce<number[]>((acc, t, i) => {
        if (t.title.toLowerCase().includes(filt)) acc.push(i);
        return acc;
      }, [])
    : tracks.map((_, i) => i);

  // --- playback ---
  const play = (i: number) => {
    const tr = tracks[i];
    if (!tr) return;
    setCurrent(i);
    setListIdx(i);
    react("meow"); // the cat greets a new track
    try {
      player.load(tr.url);
      analyzer.start(tr.url, 0);
    } catch {
      // A bad URL must never crash the UI.
    }
  };
  const pickNext = (auto: boolean): number | null => {
    const n = tracks.length;
    if (n === 0) return null;
    if (auto && repeat === "one") return current >= 0 ? current : 0;
    if (shuffle && n > 1) {
      let r = current;
      while (r === current) r = Math.floor(Math.random() * n);
      return r;
    }
    const nx = current + 1;
    if (nx >= n) return auto && repeat === "off" ? null : 0;
    return nx;
  };
  const advance = (auto: boolean) => {
    const i = pickNext(auto);
    if (i !== null) play(i);
  };

  const reload = () => {
    setTracks(loadPlaylist()); // titles resolve lazily for the visible window
  };

  const setVol = (v: number) => {
    setMutedVol(null);
    player.setVolume(v);
    saveSettings({ volume: player.state.volume });
  };
  const applyEq = (next: number[]) => {
    setEq(next);
    saveSettings({ eqGains: next });
  };

  // --- effects ---
  // Apply the equalizer to mpv on mount and whenever a band changes.
  useEffect(() => {
    player.setEqualizer(eq);
  }, [eq, player]);

  useEffect(() => {
    const onState = () => {
      // Keep the analyzer in sync with pause/resume.
      const paused = player.state.paused;
      if (paused !== prevPaused.current) {
        prevPaused.current = paused;
        if (paused) analyzer.pause();
        else analyzer.resume();
      }
      // A track that actually plays clears the unavailable-streak counter.
      if (player.state.position > 3) errRef.current = 0;
      setState({ ...player.state });
    };
    const onEnded = (r: string) => {
      if (r === "eof") {
        errRef.current = 0;
        advance(true);
      } else if (r === "error") {
        // Skip an unavailable track, but stop if the whole list is failing.
        errRef.current++;
        if (errRef.current <= tracks.length) advance(false);
      }
    };
    player.on("state", onState);
    player.on("ended", onEnded);
    return () => {
      player.off("state", onState);
      player.off("ended", onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, tracks, current, shuffle, repeat]);

  useEffect(() => {
    const onPause = () => player.togglePause();
    const onNext = () => advance(false);
    const onPrev = () => play((current - 1 + tracks.length) % (tracks.length || 1));
    const onVol = (d: number) => setVol(player.state.volume + d);
    controlBus.on("pause", onPause);
    controlBus.on("next", onNext);
    controlBus.on("prev", onPrev);
    controlBus.on("volume", onVol);
    return () => {
      controlBus.off("pause", onPause);
      controlBus.off("next", onNext);
      controlBus.off("prev", onPrev);
      controlBus.off("volume", onVol);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, tracks, current, shuffle, repeat]);

  // The analyzer writes the latest data into refs (no re-render per event);
  // a single render tick below pushes it to state. This keeps the visualizer
  // updating smoothly regardless of how events batch.
  useEffect(() => {
    const onBands = (b: number[]) => {
      specRef.current = b.map((v) => v * SPECTRUM_H);
    };
    const onWave = (w: number[]) => {
      waveRef.current = w;
    };
    analyzer.on("bands", onBands);
    analyzer.on("wave", onWave);
    return () => {
      analyzer.off("bands", onBands);
      analyzer.off("wave", onWave);
    };
  }, [analyzer]);

  // Single render tick: pushes analyzer data to state + animates plasma.
  useEffect(() => {
    const id = setInterval(() => {
      const playing = !!player.state.url && !player.state.paused;
      if (!playing) {
        specRef.current = specRef.current.map((v) => Math.max(0, v - 0.6));
      }
      // Attack fast, release slow → smoother bars; peak caps fall gently.
      const sm = smoothRef.current;
      const pk = peakRef.current;
      const tgt = specRef.current;
      for (let i = 0; i < sm.length; i++) {
        const t = tgt[i] ?? 0;
        sm[i] = t > sm[i]! ? t : sm[i]! * 0.72 + t * 0.28;
        pk[i] = Math.max(sm[i]!, pk[i]! - 0.12);
      }
      setSpec(sm.slice());
      setPeaks(pk.slice());
      setWave(waveRef.current);
      setFrame((f) => f + 1);
      setState({ ...player.state });
    }, 90);
    return () => clearInterval(id);
  }, [player]);

  // Resume the last track on mount (titles resolve lazily as you scroll).
  useEffect(() => {
    const s = loadSettings();
    if (s.lastPlaylist === activePlaylist() && s.lastUrl) {
      const idx = initialTracks.findIndex((tr) => tr.url === s.lastUrl);
      if (idx >= 0) {
        setCurrent(idx);
        setListIdx(idx);
        player.load(initialTracks[idx]!.url);
        analyzer.start(initialTracks[idx]!.url, s.lastPos ?? 0);
        if (s.lastPos) setTimeout(() => player.seekTo(s.lastPos!), 1500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazily resolve titles only for the visible window (+ a small buffer).
  useEffect(() => {
    const f = filter.trim().toLowerCase();
    const view = f
      ? tracks.reduce<number[]>((a, t, i) => {
          if (t.title.toLowerCase().includes(f)) a.push(i);
          return a;
        }, [])
      : tracks.map((_, i) => i);
    const n = view.length;
    if (n === 0) return;
    const max = Math.min(panelMax, n);
    const start =
      max < n ? Math.max(0, Math.min(listIdx - Math.floor(max / 2), n - max)) : 0;
    const from = Math.max(0, start - 5);
    const to = Math.min(n, start + max + 5);
    const idxs: number[] = [];
    for (let d = from; d < to; d++) {
      const i = view[d]!;
      const tr = tracks[i];
      if (!tr || inflight.current.has(tr.url)) continue;
      // Resolve missing titles; also backfill duration for remote tracks that
      // were cached (before durations existed) with the title only.
      const wantsMeta =
        !tr.resolved ||
        ((tr.duration === undefined || tr.artist === undefined) &&
          /^https?:\/\//i.test(tr.url));
      if (wantsMeta) {
        inflight.current.add(tr.url);
        idxs.push(i);
      }
    }
    if (idxs.length === 0) return;
    const urls = idxs.map((i) => tracks[i]!.url);
    resolveTitlesAt(tracks, idxs, (i, tr) =>
      setTracks((prev) => {
        const copy = [...prev];
        copy[i] = tr;
        return copy;
      }),
    ).finally(() => {
      for (const u of urls) inflight.current.delete(u);
    });
  }, [listIdx, tracks, panelMax, filter]);

  const quit = () => {
    const tr = tracks[current];
    if (tr) {
      saveSettings({
        lastPlaylist: activePlaylist(),
        lastUrl: tr.url,
        lastPos: Math.floor(player.state.position),
      });
    }
    analyzer.stop();
    player.quit();
    exit();
  };

  // --- async actions ---
  const doSearch = async (query: string) => {
    setOverlay({ kind: "loading", text: t("ui.searching") });
    await ensureYtDlp(() => {});
    const results = await searchYouTube(query, loadSettings().searchLimit ?? 20);
    if (results.length === 0) return setOverlay({ kind: "none" });
    setSel(0);
    setOverlay({ kind: "searchResults", results });
  };
  // Search internet radios (radio-browser.info) by name / genre / country.
  const doRadioSearch = async (query: string) => {
    setOverlay({ kind: "loading", text: t("ui.radioSearching") });
    const results = await searchRadios(query);
    if (results.length === 0) return setOverlay({ kind: "none" });
    setSel(0);
    setOverlay({ kind: "radioResults", results });
  };
  // Add (and play) the chosen station; cache its friendly name + label.
  const addStation = (s: RadioStation) => {
    const label = `📻 ${[s.country, [s.codec, s.bitrate].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(" · ")}`.trim();
    cacheStation(s.url, s.name, label);
    addUrl(s.url);
    reload();
    const idx = loadPlaylist().findIndex((tr) => tr.url === s.url);
    if (idx >= 0) play(idx);
    setOverlay({ kind: "none" });
  };
  const openList = (name: string) => {
    setPlaylists(listPlaylists());
    setSideIdx(Math.max(0, listPlaylists().indexOf(name)));
    switchPlaylist(name);
    setOverlay({ kind: "none" });
  };

  // Lists panel: a local folder path → a new list with all its music; a plain
  // name → an empty list to fill later; a URL → imports a YouTube playlist.
  const importList = async (value: string) => {
    const v = value.trim();
    if (!/^https?:\/\//i.test(v)) {
      // Looks like a path? (starts with ~ . / or contains a separator)
      if (/^[~./]/.test(v) || v.includes("/")) {
        const files = expandAudioPath(v);
        const name = v.replace(/\/+$/, "").split("/").pop() || "Local";
        return openList(createPlaylist(name, files));
      }
      return openList(createPlaylist(v, [])); // plain name → empty list
    }
    const url = v;
    setOverlay({ kind: "loading", text: t("ui.importing") });
    await ensureYtDlp(() => {});
    if (isPlaylistUrl(url)) {
      const { name, entries } = await fetchPlaylist(url);
      if (entries.length === 0) return setOverlay({ kind: "none" });
      cacheTitles(entries); // titles persist → instant on reopen, no storm
      return openList(createPlaylist(name, entries.map((e) => e.url)));
    }
    openList(createPlaylist("New playlist", [singleVideoUrl(url)]));
  };

  // Tracks panel: add a single track to the active playlist (never a playlist).
  const addTrack = (input: string) => {
    const v = input.trim();
    if (/^https?:\/\//i.test(v)) {
      addUrl(singleVideoUrl(v));
    } else {
      // A local path: a folder adds all its audio files, a file adds itself.
      for (const p of expandAudioPath(v)) addUrl(p);
    }
    reload();
    react("wink"); // the cat winks when you add a track
    setOverlay({ kind: "none" });
  };

  const switchPlaylist = (name: string) => {
    setActivePlaylist(name);
    setCurrent(-1);
    setListIdx(0);
    reload();
  };

  // --- input handling ---
  useInput((ch, key) => {
    // Overlays first.
    if (overlay.kind === "loading") return;

    // Live filter editing for the current list.
    if (filtering) {
      if (key.escape) {
        setFilter("");
        setFiltering(false);
        setListIdx(0);
        return;
      }
      if (key.return) {
        setFiltering(false);
        if (viewIdx[listIdx] != null) play(viewIdx[listIdx]!);
        return;
      }
      if (key.upArrow) return setListIdx((i) => Math.max(0, i - 1));
      if (key.downArrow)
        return setListIdx((i) => Math.min(viewIdx.length - 1, i + 1));
      if (key.backspace || key.delete) {
        setFilter((s) => s.slice(0, -1));
        setListIdx(0);
        return;
      }
      if (ch && !key.ctrl && !key.meta) {
        setFilter((s) => s + ch);
        setListIdx(0);
        return;
      }
      return;
    }

    if (
      overlay.kind === "searchInput" ||
      overlay.kind === "radioInput" ||
      overlay.kind === "addInput"
    ) {
      if (key.escape) return closeOverlay();
      if (key.return) {
        const value = input.trim();
        const ov = overlay;
        closeOverlay();
        if (!value) return;
        if (ov.kind === "searchInput") void doSearch(value);
        else if (ov.kind === "radioInput") void doRadioSearch(value);
        else if (ov.target === "list") void importList(value);
        else addTrack(value);
        return;
      }
      if (key.backspace || key.delete) return setInput((s) => s.slice(0, -1));
      if (ch && !key.ctrl && !key.meta) setInput((s) => s + ch);
      return;
    }

    if (overlay.kind === "confirmTrack") {
      if (key.return || ch === "y") {
        removeUrl(tracks[overlay.index]!.url);
        if (current === overlay.index) setCurrent(-1);
        reload();
        react("scared"); // the cat is startled when you delete
      }
      return closeOverlay();
    }
    if (overlay.kind === "confirmPlaylist") {
      if (key.return || ch === "y") {
        removePlaylist(overlay.name);
        const remaining = listPlaylists();
        setPlaylists(remaining);
        if (activePlaylist() === overlay.name) switchPlaylist(remaining[0] ?? "Default");
        react("scared");
      }
      return closeOverlay();
    }

    const listOverlays: Record<string, number> = {
      settings: 4,
      theme: listThemes().length,
      lang: SUPPORTED_LOCALES.length,
      playlists: playlists.length,
      searchLimit: SEARCH_PRESETS.length,
      searchResults:
        overlay.kind === "searchResults" ? overlay.results.length : 0,
      radioResults:
        overlay.kind === "radioResults" ? overlay.results.length : 0,
    };
    if (overlay.kind in listOverlays) {
      const count = listOverlays[overlay.kind]!;
      if (key.escape) return closeOverlay();
      if (key.upArrow) return setSel((i) => Math.max(0, i - 1));
      if (key.downArrow) return setSel((i) => Math.min(count - 1, i + 1));
      if (key.return) return chooseOverlay();
      return;
    }

    if (overlay.kind === "help") return closeOverlay();

    if (overlay.kind === "eq") {
      if (key.escape || ch === "e") return closeOverlay();
      if (key.leftArrow) return setEqBand((b) => Math.max(0, b - 1));
      if (key.rightArrow)
        return setEqBand((b) => Math.min(EQ_BANDS.length - 1, b + 1));
      if (key.upArrow || key.downArrow) {
        const next = [...eq];
        const d = key.upArrow ? 1 : -1;
        next[eqBand] = Math.max(-12, Math.min(12, (next[eqBand] ?? 0) + d));
        return applyEq(next);
      }
      if (ch === "0") return applyEq(new Array(EQ_BANDS.length).fill(0));
      if (ch === "p") {
        // Cycle to the next preset by matching the current gains.
        const i = EQ_PRESETS.findIndex(
          (pr) => JSON.stringify(pr.gains) === JSON.stringify(eq),
        );
        return applyEq(EQ_PRESETS[(i + 1) % EQ_PRESETS.length]!.gains);
      }
      return;
    }

    // Main view.
    if (ch === "q") return quit();
    if (ch === " ") return player.togglePause();
    if (key.tab) return setFocus((f) => (f === "tracks" ? "sidebar" : "tracks"));
    if (key.leftArrow) return player.seek(-5);
    if (key.rightArrow) return player.seek(5);
    if (ch === "n") return advance(false);
    if (ch === "p") return play((current - 1 + tracks.length) % (tracks.length || 1));
    if (ch === "s") return setShuffle((v) => !v);
    if (ch === "r")
      return setRepeat((v) => (v === "off" ? "all" : v === "all" ? "one" : "off"));
    if (ch === "v") {
      const idx = (VIZ_MODES as readonly string[]).indexOf(mode);
      const m = VIZ_MODES[(idx + 1) % VIZ_MODES.length]!;
      setMode(m);
      saveSettings({ vizMode: m });
      return;
    }
    if (ch === "m") return toggleMute();
    if (ch === "+" || ch === "=") return setVol(player.state.volume + 5);
    if (ch === "-") return setVol(player.state.volume - 5);
    if (ch === "/") return openOverlay({ kind: "searchInput" });
    if (ch === "R") return openOverlay({ kind: "radioInput" });
    if (ch === "a")
      return openOverlay({
        kind: "addInput",
        target: focus === "sidebar" ? "list" : "track",
      });
    if (ch === "o") return openOverlay({ kind: "settings" });
    if (ch === "e") return openOverlay({ kind: "eq" });
    if (ch === "f") {
      setFocus("tracks");
      setFiltering(true);
      return;
    }
    if (ch === "?") return openOverlay({ kind: "help" });
    if (ch === "d") {
      if (focus === "sidebar" && playlists[sideIdx]) {
        return openOverlay({ kind: "confirmPlaylist", name: playlists[sideIdx]! });
      }
      if (viewIdx[listIdx] != null)
        return openOverlay({ kind: "confirmTrack", index: viewIdx[listIdx]! });
      return;
    }

    if (focus === "tracks") {
      if (key.upArrow) return setListIdx((i) => Math.max(0, i - 1));
      if (key.downArrow)
        return setListIdx((i) => Math.min(viewIdx.length - 1, i + 1));
      if (key.return && viewIdx[listIdx] != null) return play(viewIdx[listIdx]!);
      return;
    }
    if (key.upArrow) return setSideIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) return setSideIdx((i) => Math.min(playlists.length - 1, i + 1));
    if (key.return) {
      const name = playlists[sideIdx];
      if (name) switchPlaylist(name);
    }
  });

  function openOverlay(o: Overlay) {
    setInput("");
    setSel(initialSel(o));
    setOverlay(o);
  }
  function closeOverlay() {
    setInput("");
    setOverlay({ kind: "none" });
  }
  function initialSel(o: Overlay): number {
    if (o.kind === "theme") return Math.max(0, listThemes().indexOf(activeThemeName()));
    if (o.kind === "lang") return Math.max(0, SUPPORTED_LOCALES.indexOf(getLocale()));
    if (o.kind === "playlists") return Math.max(0, playlists.indexOf(activePlaylist()));
    if (o.kind === "searchLimit")
      return Math.max(0, SEARCH_PRESETS.indexOf(loadSettings().searchLimit ?? 20));
    return 0;
  }

  function chooseOverlay() {
    if (overlay.kind === "settings") {
      const next: Overlay[] = [
        { kind: "lang" },
        { kind: "searchLimit" },
        { kind: "playlists" },
        { kind: "theme" },
      ];
      return openOverlay(next[sel] ?? { kind: "none" });
    }
    if (overlay.kind === "theme") {
      const name = listThemes()[sel];
      if (name) {
        setTheme(name);
        bump((v) => v + 1);
      }
      return closeOverlay();
    }
    if (overlay.kind === "lang") {
      const loc = SUPPORTED_LOCALES[sel];
      if (loc) {
        setLocale(loc as Locale);
        saveSettings({ lang: loc });
        bump((v) => v + 1);
      }
      return closeOverlay();
    }
    if (overlay.kind === "playlists") {
      const name = playlists[sel];
      if (name) switchPlaylist(name);
      return closeOverlay();
    }
    if (overlay.kind === "searchLimit") {
      const n = SEARCH_PRESETS[sel];
      if (n) saveSettings({ searchLimit: n });
      return closeOverlay();
    }
    if (overlay.kind === "searchResults") {
      const r = overlay.results[sel];
      if (r) {
        cacheTitles([r]);
        addUrl(r.url);
        reload();
        // play the newly added track once tracks reload
        const newIdx = loadPlaylist().findIndex((tr) => tr.url === r.url);
        if (newIdx >= 0) play(newIdx);
      }
      return closeOverlay();
    }
    if (overlay.kind === "radioResults") {
      const s = overlay.results[sel];
      if (s) addStation(s);
      else closeOverlay();
      return;
    }
  }

  function toggleMute() {
    if (mutedVol === null) {
      setMutedVol(player.state.volume);
      player.setVolume(0);
    } else {
      player.setVolume(mutedVol);
      setMutedVol(null);
    }
  }

  // --- render overlays ---
  if (overlay.kind === "eq") {
    const H = 9; // slider rows; middle row = 0 dB
    const g = eq[eqBand] ?? 0;
    const preset =
      EQ_PRESETS.find((p) => JSON.stringify(p.gains) === JSON.stringify(eq))
        ?.name ?? "Custom";
    const knobRow = (b: number) =>
      Math.round(((12 - (eq[b] ?? 0)) / 24) * (H - 1));
    return (
      <Modal
        title="Equalizer"
        cols={cols}
        rows={rows}
        width={Math.min(cols - 4, 52)}
      >
        <Text>
          {EQ_LABELS[eqBand]}Hz{"  "}
          <Text color={accent}>
            {g > 0 ? "+" : ""}
            {g} dB
          </Text>
          {"   ·   "}
          <Text color={accent}>{preset}</Text>
        </Text>
        <Box marginTop={1}>
          {EQ_BANDS.map((_, b) => (
            <Box key={b} flexDirection="column" alignItems="center" marginRight={1}>
              {Array.from({ length: H }, (_, r) => {
                const knob = r === knobRow(b);
                const zero = r === Math.floor(H / 2);
                return (
                  <Text
                    key={r}
                    color={b === eqBand ? accent : undefined}
                    dimColor={b !== eqBand && !knob}
                  >
                    {knob ? "███" : zero ? " ─ " : "   "}
                  </Text>
                );
              })}
              <Text
                color={b === eqBand ? accent : undefined}
                dimColor={b !== eqBand}
              >
                {(EQ_LABELS[b] ?? "").padStart(3)}
              </Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>←→ band · ↑↓ ±dB · 0 reset · p preset · esc close</Text>
        </Box>
      </Modal>
    );
  }
  if (overlay.kind !== "none") {
    const ov = renderOverlay(overlay, sel, input, cols, rows, playlists, frame);
    if (ov) return ov;
  }

  const loading = !!state.url && state.position === 0 && !state.paused;

  const active = activePlaylist();
  const renderPlaylist = (i: number, hl: boolean) => {
    const name = playlists[i] ?? "";
    const w = SIDEBAR_W - 4;
    const prefix = name === active ? "▶ " : hl ? "› " : "  ";
    const text = (prefix + name).slice(0, w).padEnd(w);
    return (
      <Text
        color={hl ? "black" : accent}
        backgroundColor={hl ? accent : undefined}
        bold={name === active}
      >
        {text}
      </Text>
    );
  };
  const trackW = Math.max(20, cols - SIDEBAR_W - 9);
  const renderTrack = (displayI: number, hl: boolean) => {
    const real = viewIdx[displayI]!;
    const tr = tracks[real];
    if (!tr) return null;
    const prefix = real === current ? "▶ " : hl ? "› " : "  ";
    const durStr = tr.duration ? fmtTime(tr.duration) : "";
    const room = trackW - prefix.length - (durStr ? durStr.length + 1 : 0);
    const name = tr.title.slice(0, room).padEnd(room);
    const line = durStr ? `${prefix}${name} ${durStr}` : `${prefix}${name}`;
    return (
      <Text
        color={hl ? "black" : accent}
        backgroundColor={hl ? accent : undefined}
        bold={real === current}
        dimColor={!tr.resolved && !hl}
      >
        {line}
      </Text>
    );
  };

  const clock = new Date().toTimeString().slice(0, 5);
  const reaction = frame < reactRef.current.until ? reactRef.current.type : null;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text bold color={accent}>
          ᓚᘏᗢ catunes
        </Text>
        <Text dimColor>
          ♫ {tracks.length} · {clock}
        </Text>
      </Box>
      <NowPlaying
        state={state}
        spec={spec}
        peaks={peaks}
        wave={wave}
        frame={frame}
        mode={mode}
        loading={loading}
        shuffle={shuffle}
        repeat={repeat}
        width={cols - 2}
        artist={current >= 0 ? tracks[current]?.artist : undefined}
        trackTitle={current >= 0 ? tracks[current]?.title : undefined}
        reaction={reaction}
      />
      <Box flexGrow={1}>
        <Panel
          title={t("ui.playlistsLabel").trim()}
          count={playlists.length}
          selected={sideIdx}
          focused={focus === "sidebar"}
          maxVisible={panelMax}
          renderItem={renderPlaylist}
          width={SIDEBAR_W}
        />
        <Panel
          title={
            filtering || filt
              ? `filter: ${filter}${filtering ? "▌" : ""}  (${viewIdx.length})`
              : t("ui.playlist", { n: tracks.length }).trim()
          }
          count={viewIdx.length}
          selected={listIdx}
          focused={focus === "tracks"}
          maxVisible={panelMax}
          renderItem={renderTrack}
          emptyHint={t("ui.emptyHint")}
          flexGrow={1}
        />
      </Box>
      <Box paddingX={1}>
        <Text color={accent} dimColor>
          ↑↓ · ↵ play · space · n/p · v viz ({mode}) · e eq · / search · R radios ·
          f filter · a add · d del · o settings · ? help · q quit
        </Text>
      </Box>
    </Box>
  );
}

/** Renders the active overlay (returns null for the main view). */
function renderOverlay(
  overlay: Overlay,
  sel: number,
  input: string,
  cols: number,
  rows: number,
  playlists: string[],
  frame: number,
): React.ReactElement | null {
  const accent = theme().accent;
  const maxVisible = Math.max(3, rows - 9);
  const wide = Math.min(cols - 6, 96);
  if (overlay.kind === "settings") {
    return (
      <Modal title={t("ui.settingsLabel").trim()} cols={cols} rows={rows}>
        <PickList
          selected={sel}
          maxVisible={maxVisible}
          options={[t("ui.optLanguage"), t("ui.optSearch"), t("ui.optPlaylist"), t("ui.optTheme")]}
        />
      </Modal>
    );
  }
  if (overlay.kind === "theme") {
    return (
      <Modal title={t("ui.themesLabel").trim()} cols={cols} rows={rows}>
        <PickList selected={sel} maxVisible={maxVisible} options={listThemes()} />
      </Modal>
    );
  }
  if (overlay.kind === "lang") {
    return (
      <Modal title={t("ui.langLabel").trim()} cols={cols} rows={rows}>
        <PickList
          selected={sel}
          maxVisible={maxVisible}
          options={SUPPORTED_LOCALES.map((l) => LOCALE_NAMES[l])}
        />
      </Modal>
    );
  }
  if (overlay.kind === "playlists") {
    return (
      <Modal title={t("ui.playlistsLabel").trim()} cols={cols} rows={rows} width={wide}>
        <PickList selected={sel} maxVisible={maxVisible} options={playlists} />
      </Modal>
    );
  }
  if (overlay.kind === "searchLimit") {
    return (
      <Modal title={t("ui.searchLimitLabel").trim()} cols={cols} rows={rows}>
        <PickList
          selected={sel}
          maxVisible={maxVisible}
          options={SEARCH_PRESETS.map((n) => t("ui.resultsCount", { n }))}
        />
      </Modal>
    );
  }
  if (overlay.kind === "searchResults") {
    return (
      <Modal title={t("ui.resultsLabel").trim()} cols={cols} rows={rows} width={wide}>
        <PickList
          selected={sel}
          maxVisible={maxVisible}
          options={overlay.results.map((r) => r.title)}
        />
      </Modal>
    );
  }
  if (overlay.kind === "radioResults") {
    return (
      <Modal title={t("ui.radioLabel").trim()} cols={cols} rows={rows} width={wide}>
        <PickList
          selected={sel}
          maxVisible={maxVisible}
          options={overlay.results.map(
            (s) =>
              `${s.name}  ${[s.country, [s.codec, s.bitrate ? s.bitrate + "k" : ""].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}`,
          )}
        />
      </Modal>
    );
  }
  if (
    overlay.kind === "searchInput" ||
    overlay.kind === "radioInput" ||
    overlay.kind === "addInput"
  ) {
    const isList = overlay.kind === "addInput" && overlay.target === "list";
    const prompt =
      overlay.kind === "searchInput"
        ? t("ui.searchPrompt")
        : overlay.kind === "radioInput"
          ? t("ui.radioPrompt")
          : isList
            ? t("ui.importPrompt")
            : t("ui.addPrompt");
    const title =
      overlay.kind === "searchInput"
        ? t("ui.searchLabel")
        : overlay.kind === "radioInput"
          ? t("ui.radioLabel")
          : isList
            ? t("ui.importLabel")
            : t("ui.addLabel");
    return (
      <Modal title={title.trim()} cols={cols} rows={rows} width={wide}>
        <Text>{prompt}</Text>
        <Box marginTop={1}>
          <Text color={accent} wrap="truncate-start">
            {input}
          </Text>
          <Text color={accent}>▌</Text>
        </Box>
      </Modal>
    );
  }
  if (overlay.kind === "confirmTrack" || overlay.kind === "confirmPlaylist") {
    const label =
      overlay.kind === "confirmTrack" ? t("ui.deleteConfirm", { title: "" }) : t("ui.deletePlaylistConfirm", { name: overlay.name });
    return (
      <Modal title={t("ui.deleteLabel").trim()} cols={cols} rows={rows}>
        <Text>{label}</Text>
        <Box marginTop={1}>
          <Text dimColor>↵ / y = yes · esc = no</Text>
        </Box>
      </Modal>
    );
  }
  if (overlay.kind === "loading") {
    return (
      <Modal title="catunes" cols={cols} rows={rows}>
        <Text color={accent}>
          {CAT_WALK[frame % CAT_WALK.length]!}  {overlay.text}
        </Text>
      </Modal>
    );
  }
  if (overlay.kind === "help") {
    return (
      <Modal title={t("ui.helpLabel").trim()} cols={cols} rows={rows}>
        <Text>
          ↑↓ navigate · ↵ play · space pause · ←→ seek{"\n"}
          n/p next/prev · s shuffle · r repeat · v visualizer{"\n"}
          e equalizer · f filter · / search YouTube · R radios{"\n"}
          a add · d delete · o settings · +/- volume · m mute · q quit
        </Text>
        <Box marginTop={1}>
          <Text dimColor>esc to close</Text>
        </Box>
      </Modal>
    );
  }
  return null;
}

/** Mounts the Ink UI (alternate screen, restored on exit). */
export function runInkUI(player: Player, tracks: Track[], analyzer: AudioAnalyzer) {
  process.stdout.write("\x1b[?1049h");

  // Cleanup that MUST run on every exit path — not just the `q` key. A crash,
  // Ctrl+C or a closed terminal would otherwise leave mpv (and the analyzer's
  // ffmpeg/yt-dlp) orphaned, playing on forever and stacking up.
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      analyzer.stop();
    } catch {
      // ignore
    }
    try {
      player.quit();
    } catch {
      // ignore
    }
    process.stdout.write("\x1b[?1049l"); // restore the main screen
  };
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      cleanup();
      process.exit(0);
    });
  }
  process.on("uncaughtException", (err) => {
    cleanup();
    console.error(err);
    process.exit(1);
  });

  const app = render(
    <App player={player} initialTracks={tracks} analyzer={analyzer} />,
  );
  app.waitUntilExit().then(() => {
    cleanup();
    process.exit(0);
  });
}
