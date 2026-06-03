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
import { addUrl, removeUrl, resolveTitles } from "../playlist.ts";
import {
  t,
  setLocale,
  getLocale,
  SUPPORTED_LOCALES,
  LOCALE_NAMES,
} from "../i18n.ts";
import { saveSettings } from "../config.ts";

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

export class PlayerUI {
  private screen: blessed.Widgets.Screen;
  private main: blessed.Widgets.BoxElement;
  private list: blessed.Widgets.ListElement;
  private status: blessed.Widgets.BoxElement;

  private marqueeOffset = 0;
  private spectrum: number[] = new Array(BAR_COUNT).fill(0);
  private currentIndex = -1;
  private modal = false; // true while a popup (add URL / language) is open
  private playErrors = 0; // consecutive failed tracks (anti-loop guard)
  private errorMsg: string | null = null; // transient "can't play" banner

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

    this.list = blessed.list({
      top: 14,
      left: 0,
      right: 0,
      bottom: 1,
      tags: true,
      keys: true,
      vi: true,
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
    this.screen.append(this.list);
    this.screen.append(this.status);

    this.refreshList();
    this.bindKeys();

    // Visual refresh (marquee + visualizer + timers).
    setInterval(() => this.tick(), 120);
    this.player.on("state", () => this.renderMain());
    // Auto-advance on natural end ("eof"); skip on "error" with a loop guard.
    this.player.on("ended", (reason: string) => {
      if (reason === "eof") {
        this.playErrors = 0;
        this.next();
      } else if (reason === "error") {
        const failed = this.tracks[this.currentIndex];
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
    this.player.load(track.url);
    this.refreshList();
    // Move the list highlight to follow the track that's now playing.
    this.list.select(i);
    this.renderMain();
    this.screen.render();
  }

  private next() {
    if (this.tracks.length === 0) return;
    this.playIndex((this.currentIndex + 1) % this.tracks.length);
  }

  private prev() {
    if (this.tracks.length === 0) return;
    this.playIndex(
      (this.currentIndex - 1 + this.tracks.length) % this.tracks.length,
    );
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
    this.player.setVolume(this.player.state.volume + delta);
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
    // A track started playing → clear any transient error message.
    if (this.errorMsg && s.position > 0) this.errorMsg = null;
    const width = (this.main.width as number) - 4;
    const inner = width - 2;
    const title = s.title ?? t("ui.noSong");
    const dur = fmtTime(s.duration);
    const playState = s.paused
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
    const infoRows = [
      `${playState}`,
      `{green-fg}⏱  ${fmtTime(s.position)} / ${dur}{/}`,
      `🔊 ${volBar} ${s.volume}%`,
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

  /** Removes the highlighted track from the playlist (list + file). */
  private deleteSelected() {
    const i = (this.list as unknown as { selected: number }).selected;
    const track = this.tracks[i];
    if (!track) return;
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
      (_err, value) => {
        const url = (value ?? "").trim();
        if (url) {
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
    this.list.focus();

    this.list.on("select", (_item, index) => {
      if (this.modal) return; // ignore stray Enter while a popup is open
      this.playIndex(index, true); // manual choice resets the error guard
    });

    // Global player controls are ignored while a popup (modal) is open.
    const g = (fn: () => void) => () => {
      if (!this.modal) fn();
    };

    this.screen.key(["space"], g(() => this.player.togglePause()));
    this.screen.key(["right"], g(() => this.player.seek(5)));
    this.screen.key(["left"], g(() => this.player.seek(-5)));
    this.screen.key(["n"], g(() => this.next()));
    this.screen.key(["p"], g(() => this.prev()));
    this.screen.key(["a"], g(() => this.promptAddUrl()));
    this.screen.key(["d"], g(() => this.deleteSelected()));
    this.screen.key(["l"], g(() => this.promptLanguage()));
    this.screen.key(
      ["+", "="],
      g(() => this.player.setVolume(this.player.state.volume + 5)),
    );
    this.screen.key(
      ["-"],
      g(() => this.player.setVolume(this.player.state.volume - 5)),
    );
    this.screen.key(["q", "C-c"], () => {
      this.player.quit();
      this.screen.destroy();
      process.exit(0);
    });
  }

  start() {
    this.renderMain();
    this.screen.render();
  }
}
