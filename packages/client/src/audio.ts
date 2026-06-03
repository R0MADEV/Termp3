// Real audio reactivity.
//
// We decode the currently playing track with ffmpeg (auto-installed via
// ffmpeg-static) to raw PCM in real time (-re), compute an FFT, and emit
// frequency bands the visualizer reacts to. mpv plays the audio for the user;
// this runs in parallel only for analysis (no system audio capture needed,
// so it works on macOS/Linux/Windows without any driver).

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import ffmpegPath from "ffmpeg-static";
import { ytDlpCommand } from "./ytdlp.ts";

const SAMPLE_RATE = 22050;
const FFT_SIZE = 1024;
export const BANDS = 36;
export const WAVE_POINTS = 64;

/** Downsamples a PCM frame to a normalized waveform (-1..1) for the scope. */
function waveFrom(buf: Buffer): number[] {
  const wave: number[] = [];
  for (let i = 0; i < WAVE_POINTS; i++) {
    const idx = Math.floor((i / WAVE_POINTS) * FFT_SIZE);
    wave.push(buf.readInt16LE(idx * 2) / 32768);
  }
  return wave;
}

const hann = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k;
        const b = a + (len >> 1);
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

// Log-spaced band edges over the usable bins (1 .. FFT_SIZE/2).
const bandEdges: number[] = [];
for (let b = 0; b <= BANDS; b++) {
  const f = b / BANDS;
  bandEdges.push(Math.floor(1 + (FFT_SIZE / 2 - 1) * Math.pow(f, 2.2)));
}

/** Turns one PCM frame (int16 mono) into normalized band levels (0..1). */
function analyzeFrame(buf: Buffer, peak: { v: number }): number[] {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    re[i] = (buf.readInt16LE(i * 2) / 32768) * hann[i]!;
  }
  fft(re, im);

  const bands: number[] = [];
  let frameMax = 0;
  for (let b = 0; b < BANDS; b++) {
    const lo = bandEdges[b]!;
    const hi = Math.max(lo + 1, bandEdges[b + 1]!);
    let sum = 0;
    for (let k = lo; k < hi; k++) sum += Math.hypot(re[k]!, im[k]!);
    const mag = sum / (hi - lo);
    bands.push(mag);
    if (mag > frameMax) frameMax = mag;
  }

  // Auto-gain: track a decaying peak so quiet and loud tracks both fill nicely.
  peak.v = Math.max(frameMax, peak.v * 0.999);
  const scale = peak.v > 0 ? 1 / peak.v : 0;
  return bands.map((m) => Math.min(1, Math.sqrt(m * scale)));
}

export class AudioAnalyzer extends EventEmitter {
  private procs: ChildProcess[] = [];
  private buf: Buffer = Buffer.alloc(0);
  private peak = { v: 0 };
  private gen = 0;

  /**
   * Starts analyzing a track. For remote URLs we pipe yt-dlp → ffmpeg so
   * yt-dlp handles YouTube's ranged/DASH delivery and feeds the FULL stream
   * (a raw direct URL would cut off after the first chunk). For local files
   * ffmpeg reads directly (and can fast-seek with -ss).
   */
  start(url: string, fromSec = 0): void {
    this.stop();
    const myGen = ++this.gen;
    if (!ffmpegPath || myGen !== this.gen) return;

    const remote = /^https?:\/\//i.test(url);
    const args = ["-hide_banner", "-loglevel", "quiet", "-re"];
    let yt: ChildProcess | null = null;

    if (remote) {
      yt = spawn(
        ytDlpCommand(),
        ["-f", "bestaudio/best", "-o", "-", "--no-playlist", url],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      yt.on("error", () => {});
      args.push("-i", "pipe:0");
    } else {
      if (fromSec > 0) args.push("-ss", String(Math.floor(fromSec)));
      args.push("-i", url);
    }
    args.push("-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-");

    const ff = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "ignore"] });
    ff.on("error", () => {});
    if (yt?.stdout && ff.stdin) yt.stdout.pipe(ff.stdin);

    const bytesPerFrame = FFT_SIZE * 2;
    ff.stdout?.on("data", (chunk: Buffer) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
      while (this.buf.length >= bytesPerFrame) {
        const frame = this.buf.subarray(0, bytesPerFrame);
        this.buf = this.buf.subarray(bytesPerFrame);
        this.emit("bands", analyzeFrame(frame, this.peak));
        this.emit("wave", waveFrom(frame));
      }
    });
    this.procs = yt ? [yt, ff] : [ff];
  }

  /** Freezes the analysis (kept in sync with the player on pause). */
  pause(): void {
    for (const p of this.procs) {
      try {
        p.kill("SIGSTOP");
      } catch {
        // ignore (e.g. Windows)
      }
    }
  }

  resume(): void {
    for (const p of this.procs) {
      try {
        p.kill("SIGCONT");
      } catch {
        // ignore
      }
    }
  }

  stop(): void {
    this.gen++; // invalidate any in-flight start()
    for (const p of this.procs) {
      try {
        p.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    this.procs = [];
    this.buf = Buffer.alloc(0);
  }
}
