// Modern terminal UI built with Ink (React). The core (player, playlist,
// theme, i18n, ytdlp) is reused unchanged; this is only the presentation +
// input layer.

import React, { useState, useEffect } from "react";
import { EventEmitter } from "node:events";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";
import type { Player } from "../../player.ts";
import {
  type Track,
  type SearchResult,
  loadPlaylist,
  listPlaylists,
  activePlaylist,
  setActivePlaylist,
  createPlaylist,
  removePlaylist,
  resolveTitles,
  addUrl,
  removeUrl,
  searchYouTube,
  isPlaylistUrl,
  fetchPlaylist,
} from "../../playlist.ts";
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

const SIDEBAR_W = 24;
const SPECTRUM_H = 6;
const SPECTRUM_COLS = 36;
const SEARCH_PRESETS = [10, 20, 30, 50, 100];

/** Command bus so `termp3 pause/next/...` (another tab) can drive the UI. */
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
  shuffle,
  repeat,
  width,
}: {
  state: Player["state"];
  spec: number[];
  loading: boolean;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
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
  const repIcon = repeat === "one" ? "🔂" : "🔁";
  const ratio = state.duration > 0 ? state.position / state.duration : 0;
  const progW = Math.max(10, width - 24);

  return (
    <Box borderStyle="round" borderColor={accent} flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={accent}>
          ♫ {title.slice(0, width - 22)}
        </Text>
        <Text>
          <Text color={shuffle ? accent : "gray"}>🔀 </Text>
          <Text color={repeat === "off" ? "gray" : accent}>{repIcon} </Text>
          <Text color={loading ? "yellow" : accent}>{stateText}</Text>
        </Text>
      </Box>
      <Box marginTop={1}>
        <Spectrum spec={spec} playing={!!state.url && !state.paused} />
      </Box>
      <Box marginTop={1}>
        <Text color={accent}>{bar(ratio, progW)}</Text>
        <Text dimColor>
          {" "}
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
          <Text color={accent}>{i === selected && focused ? "› " : "  "}</Text>
          {node}
        </Box>
      ))}
    </Box>
  );
}

/** Centered modal frame. */
function Modal({
  title,
  cols,
  rows,
  children,
}: {
  title: string;
  cols: number;
  rows: number;
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
        width={Math.min(cols - 4, 60)}
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
}: {
  options: string[];
  selected: number;
}) {
  const accent = theme().accent;
  return (
    <Box flexDirection="column">
      {options.map((o, i) => (
        <Text key={i} color={i === selected ? accent : undefined} bold={i === selected}>
          {i === selected ? "› " : "  "}
          {o}
        </Text>
      ))}
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
  | { kind: "searchInput" }
  | { kind: "addInput" }
  | { kind: "searchResults"; results: SearchResult[] }
  | { kind: "confirmTrack"; index: number }
  | { kind: "confirmPlaylist"; name: string }
  | { kind: "loading"; text: string };

function App({ player, initialTracks }: { player: Player; initialTracks: Track[] }) {
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
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<"off" | "all" | "one">("all");
  const [mutedVol, setMutedVol] = useState<number | null>(null);

  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const [sel, setSel] = useState(0); // selection index inside list overlays
  const [input, setInput] = useState(""); // text-input overlays
  const [, bump] = useState(0); // force re-render after theme/lang change

  // --- playback ---
  const play = (i: number) => {
    const tr = tracks[i];
    if (!tr) return;
    setCurrent(i);
    setListIdx(i);
    player.load(tr.url);
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
    const tt = loadPlaylist();
    setTracks(tt);
    resolveTitles(tt, (i, tr) =>
      setTracks((prev) => {
        const copy = [...prev];
        copy[i] = tr;
        return copy;
      }),
    ).catch(() => {});
  };

  const setVol = (v: number) => {
    setMutedVol(null);
    player.setVolume(v);
    saveSettings({ volume: player.state.volume });
  };

  // --- effects ---
  useEffect(() => {
    const onState = () => setState({ ...player.state });
    const onEnded = (r: string) => {
      if (r === "eof") advance(true);
      else if (r === "error") advance(false);
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

  // Resume + initial title resolution (once on mount).
  useEffect(() => {
    resolveTitles(initialTracks, (i, tr) =>
      setTracks((prev) => {
        const copy = [...prev];
        copy[i] = tr;
        return copy;
      }),
    ).catch(() => {});
    const s = loadSettings();
    if (s.lastPlaylist === activePlaylist() && s.lastUrl) {
      const idx = initialTracks.findIndex((tr) => tr.url === s.lastUrl);
      if (idx >= 0) {
        setCurrent(idx);
        setListIdx(idx);
        player.load(initialTracks[idx]!.url);
        if (s.lastPos) setTimeout(() => player.seekTo(s.lastPos!), 1500);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const quit = () => {
    const tr = tracks[current];
    if (tr) {
      saveSettings({
        lastPlaylist: activePlaylist(),
        lastUrl: tr.url,
        lastPos: Math.floor(player.state.position),
      });
    }
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
  const doAdd = async (url: string) => {
    if (isPlaylistUrl(url)) {
      setOverlay({ kind: "loading", text: t("ui.importing") });
      await ensureYtDlp(() => {});
      const { name, entries } = await fetchPlaylist(url);
      if (entries.length === 0) return setOverlay({ kind: "none" });
      const created = createPlaylist(name, entries.map((e) => e.url));
      setActivePlaylist(created);
      setPlaylists(listPlaylists());
      setSideIdx(Math.max(0, listPlaylists().indexOf(created)));
      reload();
      setOverlay({ kind: "none" });
      return;
    }
    addUrl(url);
    reload();
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

    if (overlay.kind === "searchInput" || overlay.kind === "addInput") {
      if (key.escape) return closeOverlay();
      if (key.return) {
        const value = input.trim();
        closeOverlay();
        if (!value) return;
        if (overlay.kind === "searchInput") void doSearch(value);
        else void doAdd(value);
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
      }
      return closeOverlay();
    }
    if (overlay.kind === "confirmPlaylist") {
      if (key.return || ch === "y") {
        removePlaylist(overlay.name);
        const remaining = listPlaylists();
        setPlaylists(remaining);
        if (activePlaylist() === overlay.name) switchPlaylist(remaining[0] ?? "Default");
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
    if (ch === "m") return toggleMute();
    if (ch === "+" || ch === "=") return setVol(player.state.volume + 5);
    if (ch === "-") return setVol(player.state.volume - 5);
    if (ch === "/") return openOverlay({ kind: "searchInput" });
    if (ch === "a") return openOverlay({ kind: "addInput" });
    if (ch === "o") return openOverlay({ kind: "settings" });
    if (ch === "?") return openOverlay({ kind: "help" });
    if (ch === "d") {
      if (focus === "sidebar" && playlists[sideIdx]) {
        return openOverlay({ kind: "confirmPlaylist", name: playlists[sideIdx]! });
      }
      if (tracks[listIdx]) return openOverlay({ kind: "confirmTrack", index: listIdx });
      return;
    }

    if (focus === "tracks") {
      if (key.upArrow) return setListIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) return setListIdx((i) => Math.min(tracks.length - 1, i + 1));
      if (key.return) return play(listIdx);
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
        addUrl(r.url);
        reload();
        // play the newly added track once tracks reload
        const newIdx = loadPlaylist().findIndex((tr) => tr.url === r.url);
        if (newIdx >= 0) play(newIdx);
      }
      return closeOverlay();
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
  if (overlay.kind !== "none") {
    const ov = renderOverlay(overlay, sel, input, cols, rows, playlists);
    if (ov) return ov;
  }

  const loading = !!state.url && state.position === 0 && !state.paused;

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
      <NowPlaying
        state={state}
        spec={spec}
        loading={loading}
        shuffle={shuffle}
        repeat={repeat}
        width={cols - 2}
      />
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
          ↑↓ · ↵ play · space · n/p · s/r · / search · a add · d del · o settings
          · ? help · q quit
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
): React.ReactElement | null {
  const accent = theme().accent;
  if (overlay.kind === "settings") {
    return (
      <Modal title={t("ui.settingsLabel").trim()} cols={cols} rows={rows}>
        <PickList
          selected={sel}
          options={[t("ui.optLanguage"), t("ui.optSearch"), t("ui.optPlaylist"), t("ui.optTheme")]}
        />
      </Modal>
    );
  }
  if (overlay.kind === "theme") {
    return (
      <Modal title={t("ui.themesLabel").trim()} cols={cols} rows={rows}>
        <PickList selected={sel} options={listThemes()} />
      </Modal>
    );
  }
  if (overlay.kind === "lang") {
    return (
      <Modal title={t("ui.langLabel").trim()} cols={cols} rows={rows}>
        <PickList selected={sel} options={SUPPORTED_LOCALES.map((l) => LOCALE_NAMES[l])} />
      </Modal>
    );
  }
  if (overlay.kind === "playlists") {
    return (
      <Modal title={t("ui.playlistsLabel").trim()} cols={cols} rows={rows}>
        <PickList selected={sel} options={playlists} />
      </Modal>
    );
  }
  if (overlay.kind === "searchLimit") {
    return (
      <Modal title={t("ui.searchLimitLabel").trim()} cols={cols} rows={rows}>
        <PickList selected={sel} options={SEARCH_PRESETS.map((n) => t("ui.resultsCount", { n }))} />
      </Modal>
    );
  }
  if (overlay.kind === "searchResults") {
    return (
      <Modal title={t("ui.resultsLabel").trim()} cols={cols} rows={rows}>
        <PickList selected={sel} options={overlay.results.map((r) => r.title)} />
      </Modal>
    );
  }
  if (overlay.kind === "searchInput" || overlay.kind === "addInput") {
    const prompt = overlay.kind === "searchInput" ? t("ui.searchPrompt") : t("ui.addPrompt");
    const title = overlay.kind === "searchInput" ? t("ui.searchLabel") : t("ui.addLabel");
    return (
      <Modal title={title.trim()} cols={cols} rows={rows}>
        <Text>{prompt}</Text>
        <Box marginTop={1}>
          <Text color={accent}>{input}</Text>
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
      <Modal title="termp3" cols={cols} rows={rows}>
        <Text color={accent}>{overlay.text}</Text>
      </Modal>
    );
  }
  if (overlay.kind === "help") {
    return (
      <Modal title={t("ui.helpLabel").trim()} cols={cols} rows={rows}>
        <Text>
          ↑↓ navigate · ↵ play · space pause · ←→ seek{"\n"}
          n/p next/prev · s shuffle · r repeat{"\n"}
          / search · a add · d delete · o settings{"\n"}
          +/- volume · m mute · Tab panel · ? help · q quit
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
export function runInkUI(player: Player, tracks: Track[]) {
  process.stdout.write("\x1b[?1049h");
  const app = render(<App player={player} initialTracks={tracks} />);
  app.waitUntilExit().then(() => {
    process.stdout.write("\x1b[?1049l");
    process.exit(0);
  });
}
