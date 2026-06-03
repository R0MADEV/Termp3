// "Mini" / windowshade mode — a thin retro strip.
//
//   ┌──────────────────────────────────────┐
//   │ ▶ Daft Punk - Around...  1:24  ▁▃▅▇▅▃ │
//   └──────────────────────────────────────┘
//
// Meant for a small terminal (and, if you like, always-on-top) so it looks
// like a floating mini player. Shares the same Player as the rest: only
// the presentation changes.

import blessed from "blessed";
import type { Player } from "../player.ts";
import type { Track } from "../playlist.ts";
import { t } from "../i18n.ts";

const MINI_BARS = "▁▂▃▄▅▆▇█";
const SPEC_COLS = 8;

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export class MiniUI {
  private screen: blessed.Widgets.Screen;
  private bar: blessed.Widgets.BoxElement;
  private marqueeOffset = 0;
  private spectrum: number[] = new Array(SPEC_COLS).fill(0);
  private currentIndex = -1;
  private playErrors = 0; // consecutive failed tracks (anti-loop guard)
  private errorMsg: string | null = null; // transient "can't play" banner
  private loading = false; // true between selecting a track and audio starting

  constructor(
    private player: Player,
    private tracks: Track[],
    position: "top" | "bottom" = "bottom",
  ) {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "termp3",
      fullUnicode: true,
    });

    this.bar = blessed.box({
      [position]: 0,
      left: 0,
      right: 0,
      height: 3,
      tags: true,
      border: { type: "line" },
      style: { border: { fg: "green" }, fg: "green", bg: "black" },
    });

    this.screen.append(this.bar);
    this.bindKeys();

    setInterval(() => this.tick(), 120);
    this.player.on("state", () => this.render());
    // Auto-advance on natural end ("eof"); skip on "error" with a loop guard.
    this.player.on("ended", (reason: string) => {
      if (reason === "eof") {
        this.playErrors = 0;
        this.next();
      } else if (reason === "error") {
        const failed = this.tracks[this.currentIndex];
        this.loading = false;
        this.playErrors++;
        if (this.playErrors < Math.max(1, this.tracks.length)) {
          this.errorMsg = t("ui.cantPlay", { title: failed?.title ?? "?" });
          this.next();
        } else {
          this.errorMsg = t("ui.allFailed");
        }
        this.render();
      }
    });
  }

  private playIndex(i: number) {
    const track = this.tracks[i];
    if (!track) return;
    this.currentIndex = i;
    this.loading = true;
    this.player.load(track.url);
    this.render();
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

  private miniSpectrum(): string {
    const playing = this.player.state.url && !this.player.state.paused;
    let out = "";
    for (let i = 0; i < SPEC_COLS; i++) {
      const lvl = playing ? this.spectrum[i] ?? 0 : 0;
      out += MINI_BARS[lvl] ?? MINI_BARS[0];
    }
    return out;
  }

  private render() {
    const s = this.player.state;
    // Audio started → clear loading flag and any transient error message.
    if (s.position > 0) {
      this.loading = false;
      if (this.errorMsg) this.errorMsg = null;
    }

    const total = (this.bar.width as number) - 2;
    if (this.errorMsg) {
      this.bar.setContent(` {red-fg}${this.marquee(this.errorMsg, total - 2)}{/} `);
      this.screen.render();
      return;
    }

    const icon = s.paused ? "⏸" : s.url ? "▶" : "■";
    const time = fmtTime(s.position);
    const spec = `{green-fg}${this.miniSpectrum()}{/}`;

    // Width available for the title = total - (icons + time + spec + margins)
    const fixed = 2 /*icon*/ + 1 + time.length + 2 + SPEC_COLS + 4;
    const titleW = Math.max(8, total - fixed);
    const title = this.loading
      ? t("ui.loading")
      : this.marquee(s.title ?? t("ui.noSong"), titleW);

    this.bar.setContent(
      ` {green-fg}${icon}{/} {bold}${title}{/}  {green-fg}${time}{/}  ${spec} `,
    );
    this.screen.render();
  }

  private tick() {
    this.marqueeOffset++;
    if (this.player.state.url && !this.player.state.paused) {
      for (let i = 0; i < SPEC_COLS; i++) {
        const target = Math.floor(Math.random() * MINI_BARS.length);
        const cur = this.spectrum[i] ?? 0;
        this.spectrum[i] = Math.round((cur * 2 + target) / 3);
      }
    } else {
      this.spectrum = this.spectrum.map((v) => Math.max(0, v - 1));
    }
    this.render();
  }

  private bindKeys() {
    this.screen.key(["space"], () => this.player.togglePause());
    this.screen.key(["right"], () => this.player.seek(5));
    this.screen.key(["left"], () => this.player.seek(-5));
    this.screen.key(["n"], () => this.next());
    this.screen.key(["p"], () => this.prev());
    this.screen.key(["+", "="], () =>
      this.player.setVolume(this.player.state.volume + 5),
    );
    this.screen.key(["-"], () =>
      this.player.setVolume(this.player.state.volume - 5),
    );
    this.screen.key(["q", "C-c"], () => {
      this.player.quit();
      this.screen.destroy();
      process.exit(0);
    });
  }

  start() {
    // Starts by playing the first track in the playlist.
    if (this.tracks.length > 0) this.playIndex(0);
    this.render();
  }
}
