// Retro terminal player UI (Phase 1).
//
// Main window (title with marquee, counter, visualizer, progress bar) +
// navigable playlist. Drives the Player; the Player knows nothing about
// this UI (decoupled layers).
//
// NOTE about the visualizer: for now it's an "animated" spectrum (reacts
// to play/pause), not derived from the real audio. Capturing the real
// spectrum from mpv will come in a later phase; visually it already nails
// the retro vibe.

import blessed from "blessed";
import type { Player } from "../player.ts";
import type { Track } from "../playlist.ts";
import {
  addUrl,
  removeUrl,
  resolveTitles,
  searchYouTube,
  isPlaylistUrl,
  fetchPlaylist,
  loadPlaylist,
  listPlaylists,
  activePlaylist,
  setActivePlaylist,
  createPlaylist,
  removePlaylist,
  type SearchResult,
} from "../playlist.ts";
import { ensureYtDlp } from "../ytdlp.ts";
import {
  t,
  setLocale,
  getLocale,
  SUPPORTED_LOCALES,
  LOCALE_NAMES,
} from "../i18n.ts";
import { saveSettings, loadSettings } from "../config.ts";

const BAR_COUNT = 40;
const SPECTRUM_HEIGHT = 6; // visualizer height in rows

// 3-row "LCD" font for the big retro counter.
const LCD: Record<string, [string, string, string]> = {
  "0": ["█▀█", "█ █", "█▄█"],
  "1": ["▀█ ", " █ ", "▄█▄"],
  "2": ["▀▀█", "█▀▀", "█▄▄"],
  "3": ["▀▀█", " ▀█", "▄▄█"],
  "4": ["█ █", "█▄█", "  █"],
  "5": ["█▀▀", "▀▀█", "▄▄█"],
  "6": ["█▀▀", "█▀█", "█▄█"],
  "7": ["▀▀█", "  █", "  █"],
  "8": ["█▀█", "█▀█", "█▄█"],
  "9": ["█▀█", "█▄█", "▄▄█"],
  ":": [" ▪ ", "   ", " ▪ "],
};

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Converts "1:24" into 3 lines of big LCD-style digits. */
function bigTime(time: string): [string, string, string] {
  const rows: [string, string, string] = ["", "", ""];
  for (const ch of time) {
    const glyph = LCD[ch] ?? ["   ", "   ", "   "];
    rows[0] += glyph[0] + " ";
    rows[1] += glyph[1] + " ";
    rows[2] += glyph[2] + " ";
  }
  return rows;
}

const SIDEBAR_W = 26; // width of the playlists sidebar

export class PlayerUI {
  private screen: blessed.Widgets.Screen;
  private main: blessed.Widgets.BoxElement;
  private list: blessed.Widgets.ListElement;
  private sidebar: blessed.Widgets.ListElement;
  private status: blessed.Widgets.BoxElement;
  private focused: "tracks" | "sidebar" = "tracks";

  private marqueeOffset = 0;
  private spectrum: number[] = new Array(BAR_COUNT).fill(0);
  private currentIndex = -1;
  private modal = false; // true while a popup (add URL / language) is open
  private playErrors = 0; // consecutive failed tracks (anti-loop guard)
  private errorMsg: string | null = null; // transient "can't play" banner
  private shuffle = false;
  private repeat: "off" | "all" | "one" = "all";
  private loading = false; // true between selecting a track and audio starting
  private mutedVol: number | null = null; // pre-mute volume while muted
  private pendingSeek: number | null = null; // resume position to apply once playing

  constructor(
    private player: Player,
    private tracks: Track[],
  ) {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "termp3",
      fullUnicode: true,
    });

    this.main = blessed.box({
      top: 0,
      left: 0,
      right: 0,
      height: 14,
      tags: true,
      border: { type: "line" },
      label: " ♫ termp3 ",
      style: { border: { fg: "green" }, fg: "green", bg: "black" },
    });

    this.sidebar = blessed.list({
      top: 14,
      left: 0,
      width: SIDEBAR_W,
      bottom: 1,
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      border: { type: "line" },
      label: t("ui.playlistsLabel"),
      style: {
        border: { fg: "gray" },
        fg: "green",
        bg: "black",
        selected: { bg: "green", fg: "black" },
      },
    });

    this.list = blessed.list({
      top: 14,
      left: SIDEBAR_W,
      right: 0,
      bottom: 1,
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      border: { type: "line" },
      label: " PLAYLIST ",
      style: {
        border: { fg: "green" },
        fg: "green",
        bg: "black",
        selected: { bg: "green", fg: "black" },
        item: { fg: "green" },
      },
    });

    this.status = blessed.box({
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      tags: true,
      content: t("ui.help"),
      style: { fg: "white", bg: "black" },
    });

    this.screen.append(this.main);
    this.screen.append(this.sidebar);
    this.screen.append(this.list);
    this.screen.append(this.status);

    this.refreshSidebar();
    this.refreshList();
    this.bindKeys();

    // Visual refresh (marquee + visualizer + timers).
    setInterval(() => this.tick(), 120);
    this.player.on("state", () => {
      // Apply the resume position once the track actually starts.
      if (this.pendingSeek !== null && this.player.state.position > 0) {
        const target = this.pendingSeek;
        this.pendingSeek = null;
        if (target > 0) this.player.seekTo(target);
      }
      this.renderMain();
    });
    // Auto-advance on natural end ("eof"); skip on "error" with a loop guard.
    this.player.on("ended", (reason: string) => {
      if (reason === "eof") {
        this.playErrors = 0;
        this.advance(true); // respects shuffle / repeat
      } else if (reason === "error") {
        const failed = this.tracks[this.currentIndex];
        this.loading = false;
        this.playErrors++;
        // Try the next track, but stop if every track has failed in a row.
        if (this.playErrors < Math.max(1, this.tracks.length)) {
          this.errorMsg = t("ui.cantPlay", { title: failed?.title ?? "?" });
          this.next();
        } else {
          this.errorMsg = t("ui.allFailed");
        }
        this.renderMain();
      }
    });
  }

  private refreshList() {
    if (this.tracks.length === 0) {
      this.list.setItems([`  {gray-fg}${t("ui.emptyHint")}{/}`]);
      this.list.setLabel(t("ui.playlist", { n: 0 }));
      this.screen.render();
      return;
    }
    const items = this.tracks.map((track, i) => {
      const playing =
        i === this.currentIndex ? "{green-fg}▶{/} " : "{gray-fg}♪{/} ";
      const num = `{gray-fg}${String(i + 1).padStart(2, " ")}.{/}`;
      const title = track.resolved
        ? track.title
        : `{gray-fg}${track.title}  …${t("ui.resolving")}{/}`;
      return `${playing}${num} ${title}`;
    });
    this.list.setItems(items);
    this.list.setLabel(t("ui.playlist", { n: this.tracks.length }));
    this.screen.render();
  }

  /** Redraws the playlists sidebar, marking the active one. */
  private refreshSidebar() {
    const names = listPlaylists();
    const active = activePlaylist();
    this.sidebar.setItems(
      names.map((n) => (n === active ? `{green-fg}▶{/} ${n}` : `  ${n}`)),
    );
    const idx = names.indexOf(active);
    if (idx >= 0) this.sidebar.select(idx);
    this.screen.render();
  }

  /** Switches the active playlist and reloads its tracks (shared logic). */
  private switchToPlaylist(name: string) {
    setActivePlaylist(name);
    this.currentIndex = -1;
    this.tracks = loadPlaylist();
    this.refreshList();
    this.refreshSidebar();
    resolveTitles(this.tracks, (i, tr) => this.updateTrack(i, tr)).catch(
      () => {},
    );
  }

  /** Moves keyboard focus between the tracks list and the sidebar. */
  private focusPanel(which: "tracks" | "sidebar") {
    this.focused = which;
    const tracksActive = which === "tracks";
    this.list.style.border.fg = tracksActive ? "green" : "gray";
    this.sidebar.style.border.fg = tracksActive ? "gray" : "green";
    (tracksActive ? this.list : this.sidebar).focus();
    this.screen.render();
  }

  /** Call this when a new title is resolved to refresh the list. */
  updateTrack(index: number, track: Track) {
    this.tracks[index] = track;
    this.refreshList();
  }

  private playIndex(i: number, resetErrors = false) {
    const track = this.tracks[i];
    if (!track) return;
    if (resetErrors) this.playErrors = 0;
    this.currentIndex = i;
    this.loading = true; // until audio actually starts (position > 0)
    this.player.load(track.url);
    this.refreshList();
    // Move the list highlight to follow the track that's now playing.
    this.list.select(i);
    this.renderMain();
    this.screen.render();
  }

  /**
   * Decides the next index to play.
   * @param auto true when triggered by a track finishing (respects repeat-one
   *   and stops at the end when repeat is "off"); false for a manual skip.
   * Returns null to mean "stop" (end reached with repeat off).
   */
  private pickNext(auto: boolean): number | null {
    const n = this.tracks.length;
    if (n === 0) return null;
    if (auto && this.repeat === "one") {
      return this.currentIndex >= 0 ? this.currentIndex : 0;
    }
    if (this.shuffle && n > 1) {
      let r = this.currentIndex;
      while (r === this.currentIndex) r = Math.floor(Math.random() * n);
      return r;
    }
    const next = this.currentIndex + 1;
    if (next >= n) return auto && this.repeat === "off" ? null : 0;
    return next;
  }

  private advance(auto: boolean) {
    const i = this.pickNext(auto);
    if (i !== null) this.playIndex(i);
  }

  /** Manual "next" (used by the keyboard and the control socket). */
  private next() {
    this.advance(false);
  }

  private prev() {
    const n = this.tracks.length;
    if (n === 0) return;
    if (this.shuffle && n > 1) {
      this.advance(false);
      return;
    }
    this.playIndex((this.currentIndex - 1 + n) % n);
  }

  // --- External control (socket): drivable from another tab ---
  controlPause() {
    this.player.togglePause();
  }
  controlNext() {
    this.next();
  }
  controlPrev() {
    this.prev();
  }
  controlVolume(delta: number) {
    this.changeVolume(delta);
  }

  /** Changes the volume and persists it. */
  private changeVolume(delta: number) {
    this.mutedVol = null; // any manual change cancels mute
    this.player.setVolume(this.player.state.volume + delta);
    saveSettings({ volume: this.player.state.volume });
    this.renderMain();
  }

  /** Mutes (volume 0) or restores the previous volume. */
  private toggleMute() {
    if (this.mutedVol === null) {
      this.mutedVol = this.player.state.volume;
      this.player.setVolume(0);
    } else {
      this.player.setVolume(this.mutedVol);
      this.mutedVol = null;
    }
    this.renderMain();
  }

  private marquee(text: string, width: number): string {
    if (text.length <= width) return text.padEnd(width);
    const padded = text + "   •   ";
    const off = this.marqueeOffset % padded.length;
    return (padded + padded).slice(off, off + width);
  }

  /** Vertical spectrum with a green→yellow→red gradient (retro style). */
  private renderSpectrumRows(width: number): string[] {
    const cols = Math.min(BAR_COUNT, Math.max(0, width));
    const rows: string[] = [];
    // From the top (high level, "hot") down to the bottom (low level, green).
    for (let level = SPECTRUM_HEIGHT - 1; level >= 0; level--) {
      const color = level >= 4 ? "red" : level >= 2 ? "yellow" : "green";
      let line = "";
      for (let i = 0; i < cols; i++) {
        const h = this.spectrum[i] ?? 0;
        line += h > level ? "█" : " ";
      }
      rows.push(`{${color}-fg}${line}{/}`);
    }
    return rows;
  }

  private renderMain() {
    const s = this.player.state;
    // Audio started → clear the loading flag and any transient error message.
    if (s.position > 0) {
      this.loading = false;
      if (this.errorMsg) this.errorMsg = null;
    }
    const width = (this.main.width as number) - 4;
    const inner = width - 2;
    const title = s.title ?? t("ui.noSong");
    const dur = fmtTime(s.duration);
    const playState = this.loading
      ? `{yellow-fg}${t("ui.loading")}{/}`
      : s.paused
        ? `{yellow-fg}⏸  ${t("ui.state.pause")}{/}`
        : s.url
          ? `{green-fg}▶  ${t("ui.state.play")}{/}`
          : `{gray-fg}■  ${t("ui.state.stop")}{/}`;

    // Big LCD counter (3 rows) on the left + info on the right.
    const [t1, t2, t3] = bigTime(fmtTime(s.position));
    const lcdW = 26;
    const volBarW = 12;
    const volFilled = Math.round((Math.min(100, s.volume) / 100) * volBarW);
    const volBar =
      "{green-fg}" +
      "▉".repeat(volFilled) +
      "{/}{gray-fg}" +
      "░".repeat(volBarW - volFilled) +
      "{/}";
    const shuf = this.shuffle ? "{green-fg}🔀{/}" : "{gray-fg}🔀{/}";
    const rep =
      this.repeat === "one"
        ? "{green-fg}🔂{/}"
        : this.repeat === "all"
          ? "{green-fg}🔁{/}"
          : "{gray-fg}🔁{/}";
    const infoRows = [
      `${playState}   ${shuf} ${rep}`,
      `{green-fg}⏱  ${fmtTime(s.position)} / ${dur}{/}`,
      `${s.volume === 0 ? "🔇" : "🔊"} ${volBar} ${s.volume}%`,
    ];
    const lcdRows = [t1, t2, t3].map(
      (r, i) =>
        `  {bold}{green-fg}${r}{/}{/}`.padEnd(lcdW + 24) + (infoRows[i] ?? ""),
    );

    // Wide progress bar.
    const barW = Math.max(10, inner - 14);
    const ratio = s.duration > 0 ? Math.min(1, s.position / s.duration) : 0;
    const filled = Math.round(ratio * barW);
    const progress =
      "{green-fg}" +
      "━".repeat(filled) +
      "◉{/}{gray-fg}" +
      "━".repeat(Math.max(0, barW - filled)) +
      "{/}";

    const spectrum = this.renderSpectrumRows(inner).map((r) => `  ${r}`);

    const firstLine = this.errorMsg
      ? `  {red-fg}${this.marquee(this.errorMsg, inner - 2)}{/}`
      : `  {green-fg}♪{/} {bold}${this.marquee(title, inner - 4)}{/}`;

    const content = [
      firstLine,
      "",
      ...lcdRows,
      "",
      ...spectrum,
      `  ${progress} ${fmtTime(s.position)}/${dur}`,
    ].join("\n");

    this.main.setContent(content);
    this.screen.render();
  }

  private tick() {
    this.marqueeOffset++;
    // Visualizer animation (reactive pseudo-spectrum).
    if (this.player.state.url && !this.player.state.paused) {
      for (let i = 0; i < BAR_COUNT; i++) {
        // Analyzer-like curve: more energy in the lows/mids (center-left).
        const bias = 1 - Math.abs(i - BAR_COUNT * 0.35) / BAR_COUNT;
        const target = Math.round(Math.random() * SPECTRUM_HEIGHT * bias * 1.6);
        const cur = this.spectrum[i] ?? 0;
        // smoothing so it doesn't flicker abruptly
        this.spectrum[i] = Math.max(
          0,
          Math.min(SPECTRUM_HEIGHT, Math.round((cur * 2 + target) / 3)),
        );
      }
    } else {
      this.spectrum = this.spectrum.map((v) => Math.max(0, v - 1));
    }
    this.renderMain();
  }

  /** Asks for confirmation, then removes the highlighted track (list + file). */
  private deleteSelected() {
    const i = (this.list as unknown as { selected: number }).selected;
    const track = this.tracks[i];
    if (!track) return;

    const q = blessed.question({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "60%",
      height: "shrink",
      tags: true,
      border: { type: "line" },
      label: t("ui.deleteLabel"),
      style: { border: { fg: "red" }, fg: "green", bg: "black" },
    });
    this.modal = true;
    q.ask(t("ui.deleteConfirm", { title: track.title }), (_err, ok) => {
      if (ok) {
        removeUrl(track.url);
        this.tracks.splice(i, 1);
        // Keep currentIndex pointing at the right track after the removal.
        if (this.currentIndex === i) this.currentIndex = -1;
        else if (this.currentIndex > i) this.currentIndex--;
        this.refreshList();
        if (this.tracks.length > 0) {
          this.list.select(Math.min(i, this.tracks.length - 1));
        }
        this.renderMain();
      }
      // Defer refocus so the closing keypress doesn't reach the playlist.
      setTimeout(() => {
        this.modal = false;
        this.list.focus();
        this.screen.render();
      }, 0);
    });
  }

  /** Asks for confirmation, then deletes the selected playlist (file). */
  private deletePlaylistSelected() {
    const names = listPlaylists();
    const i = (this.sidebar as unknown as { selected: number }).selected;
    const name = names[i];
    if (!name) return;

    const q = blessed.question({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "60%",
      height: "shrink",
      tags: true,
      border: { type: "line" },
      label: t("ui.deleteLabel"),
      style: { border: { fg: "red" }, fg: "green", bg: "black" },
    });
    this.modal = true;
    q.ask(t("ui.deletePlaylistConfirm", { name }), (_err, ok) => {
      if (ok) {
        removePlaylist(name);
        const remaining = listPlaylists(); // recreates Default if none are left
        if (activePlaylist() === name) {
          this.switchToPlaylist(remaining[0] ?? "Default");
        } else {
          this.refreshSidebar();
        }
      }
      setTimeout(() => {
        this.modal = false;
        this.focusPanel("sidebar");
      }, 0);
    });
  }

  /** Closes the modal and refocuses the list on the next tick. */
  private endModal() {
    setTimeout(() => {
      this.modal = false;
      this.list.focus();
      this.screen.render();
    }, 0);
  }

  /** Shows a brief notice box, then ends the modal. */
  private flashThenEnd(msg: string) {
    const box = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "40%",
      height: 3,
      tags: true,
      border: { type: "line" },
      content: `  ${msg}`,
      style: { border: { fg: "yellow" }, fg: "yellow", bg: "black" },
    });
    this.screen.render();
    setTimeout(() => {
      box.destroy();
      this.endModal();
    }, 1200);
  }

  /** Asks for a query, searches YouTube, and lets the user pick a result. */
  private promptSearch() {
    const prompt = blessed.prompt({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "70%",
      height: 9,
      tags: true,
      border: { type: "line" },
      label: t("ui.searchLabel"),
      style: { border: { fg: "green" }, fg: "green", bg: "black" },
    });
    this.modal = true;
    prompt.input(t("ui.searchPrompt"), "", async (_err, value) => {
      const q = (value ?? "").trim();
      if (!q) return this.endModal();

      const loading = blessed.box({
        parent: this.screen,
        top: "center",
        left: "center",
        width: "50%",
        height: 3,
        tags: true,
        border: { type: "line" },
        content: `  ${t("ui.searching")}`,
        style: { border: { fg: "green" }, fg: "green", bg: "black" },
      });
      this.screen.render();

      await ensureYtDlp(() => {}); // make sure yt-dlp exists (silent)
      const limit = loadSettings().searchLimit ?? 20;
      const results = await searchYouTube(q, limit);
      loading.destroy();

      if (results.length === 0) return this.flashThenEnd(t("ui.noResults"));
      this.showSearchResults(results);
    });
  }

  private showSearchResults(results: SearchResult[]) {
    const picker = blessed.list({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "80%",
      height: Math.min(results.length + 2, 16),
      scrollable: true,
      tags: true,
      keys: true,
      vi: true,
      border: { type: "line" },
      label: t("ui.resultsLabel"),
      items: results.map((r, i) => ` ${String(i + 1).padStart(2)}. ${r.title}`),
      style: {
        border: { fg: "green" },
        fg: "green",
        bg: "black",
        selected: { bg: "green", fg: "black" },
      },
    });
    picker.on("select", (_item, index) => {
      const chosen = results[index];
      if (chosen) {
        addUrl(chosen.url);
        this.tracks.push({
          url: chosen.url,
          title: chosen.title,
          resolved: true,
        });
        this.refreshList();
        this.playIndex(this.tracks.length - 1, true); // play the new track
      }
      picker.destroy();
      this.endModal();
    });
    picker.key(["escape"], () => {
      picker.destroy();
      this.endModal();
    });
    picker.focus();
    this.screen.render();
  }

  /** Popup window to paste a URL and add it to the playlist on the fly. */
  private promptAddUrl() {
    const prompt = blessed.prompt({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "70%",
      height: 9,
      tags: true,
      border: { type: "line" },
      label: t("ui.addLabel"),
      style: { border: { fg: "green" }, fg: "green", bg: "black" },
    });
    this.modal = true;
    prompt.input(
      t("ui.addPrompt"),
      "",
      async (_err, value) => {
        const url = (value ?? "").trim();
        if (url && isPlaylistUrl(url)) {
          // Expand a YouTube playlist/album into all its tracks.
          const loading = blessed.box({
            parent: this.screen,
            top: "center",
            left: "center",
            width: "50%",
            height: 3,
            tags: true,
            border: { type: "line" },
            content: `  ${t("ui.importing")}`,
            style: { border: { fg: "green" }, fg: "green", bg: "black" },
          });
          this.screen.render();
          await ensureYtDlp(() => {});
          const { name, entries } = await fetchPlaylist(url);
          loading.destroy();
          if (entries.length === 0) return this.flashThenEnd(t("ui.noResults"));
          // Save as its own playlist and switch to it (don't touch the current).
          const created = createPlaylist(
            name,
            entries.map((e) => e.url),
          );
          setActivePlaylist(created);
          this.currentIndex = -1;
          this.tracks = entries.map((e) => ({
            url: e.url,
            title: e.title,
            resolved: true,
          }));
          this.refreshList();
          this.refreshSidebar();
          this.playIndex(0, true);
          return this.flashThenEnd(
            t("ui.importedTo", { n: entries.length, name: created }),
          );
        } else if (url) {
          const res = addUrl(url);
          if (res.added) {
            this.tracks.push({ url, title: url, resolved: false });
            this.refreshList();
            resolveTitles(this.tracks, (i, track) =>
              this.updateTrack(i, track),
            ).catch(() => {});
          }
        }
        setTimeout(() => {
          this.modal = false;
          this.list.focus();
          this.screen.render();
        }, 0);
      },
    );
  }

  /** Re-applies translated texts after a language change. */
  private applyLocale() {
    this.status.setContent(t("ui.help"));
    this.refreshList();
    this.renderMain();
    this.screen.render();
  }

  /** Full-screen keyboard help overlay. */
  private showHelp() {
    const box = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 46,
      height: 21,
      tags: true,
      keys: true,
      scrollable: true,
      border: { type: "line" },
      label: t("ui.helpLabel"),
      content: t("ui.helpScreen"),
      style: { border: { fg: "green" }, fg: "green", bg: "black" },
    });
    this.modal = true;
    const close = () => {
      box.destroy();
      this.endModal();
    };
    box.key(["escape", "?"], close);
    box.focus();
    this.screen.render();
  }

  /** Settings menu: routes to the language or search-results pickers. */
  private openSettings() {
    const cur = loadSettings();
    const options = [
      {
        label: `${t("ui.optLanguage")}:  ${LOCALE_NAMES[getLocale()]}`,
        action: () => this.promptLanguage(),
      },
      {
        label: `${t("ui.optSearch")}:  ${cur.searchLimit ?? 20}`,
        action: () => this.promptSearchLimit(),
      },
      {
        label: `${t("ui.optPlaylist")}:  ${activePlaylist()}`,
        action: () => this.promptPlaylists(),
      },
    ];
    const menu = blessed.list({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 44,
      height: options.length + 2,
      tags: true,
      keys: true,
      vi: true,
      border: { type: "line" },
      label: t("ui.settingsLabel"),
      items: options.map((o) => o.label),
      style: {
        border: { fg: "green" },
        fg: "green",
        bg: "black",
        selected: { bg: "green", fg: "black" },
      },
    });
    this.modal = true;
    menu.on("select", (_item, index) => {
      menu.destroy();
      options[index]?.action();
    });
    menu.key(["escape"], () => {
      menu.destroy();
      this.endModal();
    });
    menu.focus();
    this.screen.render();
  }

  /** Picker to switch the active playlist; reloads its tracks. */
  private promptPlaylists() {
    const names = listPlaylists();
    const picker = blessed.list({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 40,
      height: Math.min(names.length + 2, 14),
      tags: true,
      keys: true,
      vi: true,
      scrollable: true,
      border: { type: "line" },
      label: t("ui.playlistsLabel"),
      items: names,
      style: {
        border: { fg: "green" },
        fg: "green",
        bg: "black",
        selected: { bg: "green", fg: "black" },
      },
    });
    const cur = names.indexOf(activePlaylist());
    if (cur >= 0) picker.select(cur);
    picker.on("select", (_item, index) => {
      const name = names[index];
      picker.destroy();
      if (name) this.switchToPlaylist(name);
      this.endModal();
    });
    picker.key(["escape"], () => {
      picker.destroy();
      this.endModal();
    });
    picker.focus();
    this.screen.render();
  }

  /** Popup to pick how many search results to fetch; persists the choice. */
  private promptSearchLimit() {
    const presets = [10, 20, 30, 50, 100];
    const cur = loadSettings().searchLimit ?? 20;
    const picker = blessed.list({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 30,
      height: presets.length + 2,
      tags: true,
      keys: true,
      vi: true,
      border: { type: "line" },
      label: t("ui.searchLimitLabel"),
      items: presets.map((p) => t("ui.resultsCount", { n: p })),
      style: {
        border: { fg: "green" },
        fg: "green",
        bg: "black",
        selected: { bg: "green", fg: "black" },
      },
    });
    const idx = presets.indexOf(cur);
    if (idx >= 0) picker.select(idx);
    picker.on("select", (_item, index) => {
      const v = presets[index];
      if (v) saveSettings({ searchLimit: v });
      picker.destroy();
      this.endModal();
    });
    picker.key(["escape"], () => {
      picker.destroy();
      this.endModal();
    });
    picker.focus();
    this.screen.render();
  }

  /** Popup to pick the interface language; persists the choice. */
  private promptLanguage() {
    const names = SUPPORTED_LOCALES.map((l) => LOCALE_NAMES[l]);
    const picker = blessed.list({
      parent: this.screen,
      top: "center",
      left: "center",
      width: 30,
      height: SUPPORTED_LOCALES.length + 2,
      tags: true,
      keys: true,
      vi: true,
      border: { type: "line" },
      label: t("ui.langLabel"),
      items: names,
      style: {
        border: { fg: "green" },
        fg: "green",
        bg: "black",
        selected: { bg: "green", fg: "black" },
      },
    });
    // Pre-select the current language.
    const cur = SUPPORTED_LOCALES.indexOf(getLocale());
    if (cur >= 0) picker.select(cur);

    this.modal = true;
    const close = () => {
      picker.destroy();
      // Refocus the list on the next tick so the closing keypress (Enter)
      // does not bubble into the playlist and restart the current track.
      setTimeout(() => {
        this.modal = false;
        this.list.focus();
        this.screen.render();
      }, 0);
    };
    picker.on("select", (_item, index) => {
      const loc = SUPPORTED_LOCALES[index];
      if (loc) {
        setLocale(loc);
        saveSettings({ lang: loc });
        this.applyLocale();
      }
      close();
    });
    picker.key(["escape"], close);
    picker.focus();
    this.screen.render();
  }

  private bindKeys() {
    this.focusPanel("tracks");

    this.list.on("select", (_item, index) => {
      if (this.modal) return; // ignore stray Enter while a popup is open
      this.playIndex(index, true); // manual choice resets the error guard
    });

    this.sidebar.on("select", (_item, index) => {
      if (this.modal) return;
      const name = listPlaylists()[index];
      if (name) this.switchToPlaylist(name);
    });

    // Clicking a panel moves focus to it.
    this.list.on("click", () => this.focusPanel("tracks"));
    this.sidebar.on("click", () => this.focusPanel("sidebar"));

    // Global player controls are ignored while a popup (modal) is open.
    const g = (fn: () => void) => () => {
      if (!this.modal) fn();
    };

    // Tab switches focus between the playlist and the sidebar.
    this.screen.key(["tab"], g(() => this.focusPanel(
      this.focused === "tracks" ? "sidebar" : "tracks",
    )));

    this.screen.key(["space"], g(() => this.player.togglePause()));
    this.screen.key(["right"], g(() => this.player.seek(5)));
    this.screen.key(["left"], g(() => this.player.seek(-5)));
    this.screen.key(["n"], g(() => this.next()));
    this.screen.key(["p"], g(() => this.prev()));
    this.screen.key(
      ["s"],
      g(() => {
        this.shuffle = !this.shuffle;
        this.renderMain();
      }),
    );
    this.screen.key(
      ["r"],
      g(() => {
        this.repeat =
          this.repeat === "off" ? "all" : this.repeat === "all" ? "one" : "off";
        this.renderMain();
      }),
    );
    this.screen.key(["a"], g(() => this.promptAddUrl()));
    this.screen.key(["/"], g(() => this.promptSearch()));
    this.screen.key(
      ["d"],
      g(() =>
        this.focused === "sidebar"
          ? this.deletePlaylistSelected()
          : this.deleteSelected(),
      ),
    );
    this.screen.key(["l"], g(() => this.promptLanguage()));
    this.screen.key(["o"], g(() => this.openSettings()));
    this.screen.key(["?"], g(() => this.showHelp()));
    this.screen.key(["+", "="], g(() => this.changeVolume(5)));
    this.screen.key(["-"], g(() => this.changeVolume(-5)));
    this.screen.key(["m"], g(() => this.toggleMute()));
    this.screen.key(["q", "C-c"], () => {
      this.saveResume();
      this.player.quit();
      this.screen.destroy();
      process.exit(0);
    });
  }

  /** Persists the current track + position so the next launch can resume. */
  private saveResume() {
    const track = this.tracks[this.currentIndex];
    if (!track) return;
    saveSettings({
      lastPlaylist: activePlaylist(),
      lastUrl: track.url,
      lastPos: Math.floor(this.player.state.position),
    });
  }

  /** Resumes the last track + position if it's still in the active playlist. */
  private resumeIfPossible() {
    const s = loadSettings();
    if (s.lastPlaylist !== activePlaylist()) return;
    if (!s.lastUrl) return;
    const idx = this.tracks.findIndex((t) => t.url === s.lastUrl);
    if (idx < 0) return;
    this.pendingSeek = s.lastPos ?? 0;
    this.playIndex(idx);
  }

  start() {
    this.resumeIfPossible();
    this.renderMain();
    this.screen.render();
  }
}
