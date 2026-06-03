// Modern UI built with Ink (React for the terminal). Prototype on the
// ink-ui branch to compare against the blessed UI. The core (player,
// playlist, theme, i18n) is reused unchanged.

import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";
import type { Player } from "../../player.ts";
import {
  type Track,
  loadPlaylist,
  listPlaylists,
  activePlaylist,
  setActivePlaylist,
  resolveTitles,
} from "../../playlist.ts";
import {
  theme,
  listThemes,
  activeThemeName,
  setTheme,
} from "../../theme.ts";
import { t } from "../../i18n.ts";

const SIDEBAR_W = 24;
const SPECTRUM_H = 6;
const SPECTRUM_COLS = 36;

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

function useTermSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    cols: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  });
  useEffect(() => {
    const on = () => setSize({ cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    stdout.on("resize", on);
    return () => {
      stdout.off("resize", on);
    };
  }, [stdout]);
  return size;
}

function Spectrum({ spec, playing }: { spec: number[]; playing: boolean }) {
  const [low, mid, high] = theme().spectrum;
  const rows = [];
  for (let level = SPECTRUM_H - 1; level >= 0; level--) {
    const color = level >= 4 ? high : level >= 2 ? mid : low;
    let line = "";
    for (let i = 0; i < SPECTRUM_COLS; i++) {
      const h = playing ? (spec[i] ?? 0) : 0;
      line += h > level ? "█" : " ";
    }
    rows.push(
      <Text key={level} color={color}>
        {line}
      </Text>,
    );
  }
  return <Box flexDirection="column">{rows}</Box>;
}

function NowPlaying({
  state,
  spec,
  loading,
  width,
}: {
  state: Player["state"];
  spec: number[];
  loading: boolean;
  width: number;
}) {
  const accent = theme().accent;
  const dur = fmtTime(state.duration);
  const title = state.title ?? t("ui.noSong");
  const stateText = loading
    ? t("ui.loading")
    : state.paused
      ? `⏸  ${t("ui.state.pause")}`
      : state.url
        ? `▶  ${t("ui.state.play")}`
        : `■  ${t("ui.state.stop")}`;
  const ratio = state.duration > 0 ? state.position / state.duration : 0;
  const progW = Math.max(10, width - 24);

  return (
    <Box
      borderStyle="round"
      borderColor={accent}
      flexDirection="column"
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={accent}>
          ♫ {title.slice(0, width - 18)}
        </Text>
        <Text color={loading ? "yellow" : accent}>{stateText}</Text>
      </Box>
      <Box marginTop={1}>
        <Spectrum spec={spec} playing={!!state.url && !state.paused} />
      </Box>
      <Box marginTop={1}>
        <Text color={accent}>{bar(ratio, progW)}</Text>
        <Text> </Text>
        <Text dimColor>
          {fmtTime(state.position)} / {dur}
        </Text>
      </Box>
      <Box>
        <Text>{state.volume === 0 ? "🔇" : "🔊"} </Text>
        <Text color={accent}>{bar(state.volume / 100, 12)}</Text>
        <Text dimColor> {state.volume}%</Text>
      </Box>
    </Box>
  );
}

function Panel({
  title,
  items,
  selected,
  focused,
  width,
  flexGrow,
}: {
  title: string;
  items: React.ReactNode[];
  selected: number;
  focused: boolean;
  width?: number;
  flexGrow?: number;
}) {
  const accent = theme().accent;
  return (
    <Box
      borderStyle="round"
      borderColor={focused ? accent : "gray"}
      flexDirection="column"
      paddingX={1}
      width={width}
      flexGrow={flexGrow}
    >
      <Text bold color={focused ? accent : "gray"}>
        {title}
      </Text>
      {items.map((node, i) => (
        <Box key={i}>
          {i === selected && focused ? (
            <Text color={accent}>{"› "}</Text>
          ) : (
            <Text>{"  "}</Text>
          )}
          {node}
        </Box>
      ))}
    </Box>
  );
}

function ThemePicker({
  names,
  selected,
  cols,
  rows,
}: {
  names: string[];
  selected: number;
  cols: number;
  rows: number;
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
      >
        <Text bold color={accent}>
          {t("ui.themesLabel").trim()}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {names.map((n, i) => (
            <Text key={n} color={i === selected ? accent : undefined}>
              {i === selected ? "› " : "  "}
              {n}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑↓ · ↵ select · esc cancel</Text>
        </Box>
      </Box>
    </Box>
  );
}

function App({
  player,
  initialTracks,
}: {
  player: Player;
  initialTracks: Track[];
}) {
  const { exit } = useApp();
  const { cols, rows } = useTermSize();
  const accent = theme().accent;

  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [playlists] = useState<string[]>(listPlaylists());
  const [focus, setFocus] = useState<"tracks" | "sidebar">("tracks");
  const [listIdx, setListIdx] = useState(0);
  const [sideIdx, setSideIdx] = useState(
    Math.max(0, listPlaylists().indexOf(activePlaylist())),
  );
  const [current, setCurrent] = useState(-1);
  const [state, setState] = useState({ ...player.state });
  const [spec, setSpec] = useState<number[]>(new Array(SPECTRUM_COLS).fill(0));
  const [overlay, setOverlay] = useState<"none" | "theme">("none");
  const [themeIdx, setThemeIdx] = useState(0);
  const [, setThemeVersion] = useState(0); // bump to re-render after a theme change

  const play = useCallback(
    (i: number) => {
      const tr = tracks[i];
      if (!tr) return;
      setCurrent(i);
      player.load(tr.url);
    },
    [tracks, player],
  );

  const next = useCallback(() => {
    if (tracks.length) play((current + 1) % tracks.length);
  }, [tracks, current, play]);

  const prev = useCallback(() => {
    if (tracks.length) play((current - 1 + tracks.length) % tracks.length);
  }, [tracks, current, play]);

  useEffect(() => {
    const onState = () => setState({ ...player.state });
    const onEnded = (r: string) => {
      if (r === "eof") next();
    };
    player.on("state", onState);
    player.on("ended", onEnded);
    return () => {
      player.off("state", onState);
      player.off("ended", onEnded);
    };
  }, [player, next]);

  useEffect(() => {
    const id = setInterval(() => {
      const playing = !!player.state.url && !player.state.paused;
      setSpec((prev) =>
        prev.map((v) => {
          if (!playing) return Math.max(0, v - 1);
          const target = Math.round(Math.random() * SPECTRUM_H);
          return Math.max(0, Math.min(SPECTRUM_H, Math.round((v * 2 + target) / 3)));
        }),
      );
    }, 120);
    return () => clearInterval(id);
  }, [player]);

  useEffect(() => {
    resolveTitles(tracks, (i, tr) =>
      setTracks((prev) => {
        const copy = [...prev];
        copy[i] = tr;
        return copy;
      }),
    ).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length]);

  useInput((input, key) => {
    if (overlay === "theme") {
      const names = listThemes();
      if (key.upArrow) setThemeIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setThemeIdx((i) => Math.min(names.length - 1, i + 1));
      if (key.escape) setOverlay("none");
      if (key.return) {
        const name = names[themeIdx];
        if (name) {
          setTheme(name);
          setThemeVersion((v) => v + 1);
        }
        setOverlay("none");
      }
      return;
    }

    if (input === "q") {
      player.quit();
      exit();
      return;
    }
    if (input === "o") {
      const names = listThemes();
      setThemeIdx(Math.max(0, names.indexOf(activeThemeName())));
      setOverlay("theme");
      return;
    }
    if (key.tab) {
      setFocus((f) => (f === "tracks" ? "sidebar" : "tracks"));
      return;
    }
    if (input === " ") return player.togglePause();
    if (key.leftArrow) return player.seek(-5);
    if (key.rightArrow) return player.seek(5);
    if (input === "n") return next();
    if (input === "p") return prev();
    if (input === "+" || input === "=") return player.setVolume(state.volume + 5);
    if (input === "-") return player.setVolume(state.volume - 5);

    if (focus === "tracks") {
      if (key.upArrow) setListIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setListIdx((i) => Math.min(tracks.length - 1, i + 1));
      if (key.return) play(listIdx);
      return;
    }
    if (key.upArrow) setSideIdx((i) => Math.max(0, i - 1));
    if (key.downArrow) setSideIdx((i) => Math.min(playlists.length - 1, i + 1));
    if (key.return) {
      const name = playlists[sideIdx];
      if (!name) return;
      setActivePlaylist(name);
      const tt = loadPlaylist();
      setTracks(tt);
      setCurrent(-1);
      setListIdx(0);
    }
  });

  if (overlay === "theme") {
    return (
      <ThemePicker
        names={listThemes()}
        selected={themeIdx}
        cols={cols}
        rows={rows}
      />
    );
  }

  const loading = !!state.url && state.position === 0 && !state.paused;
  const innerW = cols - 2;

  const sideItems = playlists.map((name) => (
    <Text key={name} color={accent} bold={name === activePlaylist()}>
      {name === activePlaylist() ? "▶ " : "  "}
      {name.slice(0, SIDEBAR_W - 6)}
    </Text>
  ));

  const trackItems = tracks.map((tr, i) => (
    <Text key={i} color={accent} bold={i === current} dimColor={!tr.resolved}>
      {i === current ? "▶ " : "  "}
      {tr.title.slice(0, cols - SIDEBAR_W - 8)}
    </Text>
  ));

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <NowPlaying state={state} spec={spec} loading={loading} width={innerW} />
      <Box flexGrow={1}>
        <Panel
          title={t("ui.playlistsLabel").trim()}
          items={sideItems}
          selected={sideIdx}
          focused={focus === "sidebar"}
          width={SIDEBAR_W}
        />
        <Panel
          title={t("ui.playlist", { n: tracks.length }).trim()}
          items={
            trackItems.length
              ? trackItems
              : [<Text key="e" dimColor>{t("ui.emptyHint")}</Text>]
          }
          selected={listIdx}
          focused={focus === "tracks"}
          flexGrow={1}
        />
      </Box>
      <Box paddingX={1}>
        <Text dimColor>
          ↑↓ nav · ↵ play · space pause · n/p · Tab panel · o theme · q quit
        </Text>
      </Box>
    </Box>
  );
}

/** Mounts the Ink UI (alternate screen, restored on exit). */
export function runInkUI(player: Player, tracks: Track[]) {
  process.stdout.write("\x1b[?1049h");
  const app = render(<App player={player} initialTracks={tracks} />);
  app.waitUntilExit().then(() => {
    process.stdout.write("\x1b[?1049l");
    process.exit(0);
  });
}
