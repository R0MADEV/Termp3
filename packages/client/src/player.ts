// mpv wrapper over IPC.
//
// We launch mpv in "idle" mode with a control socket and send it
// JSON commands (load, pause, seek, volume...). mpv plays the audio
// LOCALLY through the user's speakers; we just drive it.
//
// IMPORTANT (layered design): this module knows NOTHING about rooms or
// WebSocket. It only exposes play/pause/seek/etc. Whoever issues the commands
// can be the keyboard (solo mode) or the room (synced mode): the
// player doesn't care.

import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { YTDLP_DIR } from "./ytdlp.ts";

/** 10-band graphic-equalizer center frequencies (Hz). */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

// Pre-computed per-band filter prefixes — avoids template-literal work
// inside the hot eqFilterChain loop.
const _EQ_PREFIXES: string[] = EQ_BANDS.map(
  (f) => `equalizer=f=${f}:width_type=o:width=1:g=`,
);

// Cache for eqFilterChain: skip recomputation when gains haven't changed.
let _lastEqKey = "";
let _lastEqResult = "";

/** Builds the mpv audio-filter value for a set of EQ gains (dB). "" = flat. */
export function eqFilterChain(gains: number[]): string {
  if (!gains.some((g) => Math.abs(g) > 0.01)) return "";

  // Build a cheap cache key from the rounded gains.
  const rounded: string[] = new Array(EQ_BANDS.length);
  for (let i = 0; i < EQ_BANDS.length; i++) {
    rounded[i] = (gains[i] ?? 0).toFixed(1);
  }
  const key = rounded.join(",");
  if (key === _lastEqKey) return _lastEqResult;

  // Build the chain using pre-computed prefixes.
  const parts: string[] = new Array(EQ_BANDS.length);
  for (let i = 0; i < EQ_BANDS.length; i++) {
    parts[i] = _EQ_PREFIXES[i] + rounded[i];
  }
  _lastEqResult = `lavfi=[${parts.join(",")}]`;
  _lastEqKey = key;
  return _lastEqResult;
}

export interface PlayerState {
  url: string | null;
  title: string | null;
  paused: boolean;
  position: number; // seconds
  duration: number; // seconds
  volume: number; // 0-100
}

type MpvCommand = { command: unknown[]; request_id?: number };

// Pre-serialized JSON for commands that never change — avoids
// JSON.stringify + object allocation on every call.
const _CMD_STOP = '{"command":["stop"]}\n';
const _CMD_QUIT = '{"command":["quit"]}\n';

// Reusable command object for `send` — mutated in place to avoid allocations.
const _sendBuf: MpvCommand = { command: [] };

export class Player extends EventEmitter {
  private proc: ChildProcess | null = null;
  private socket: Socket | null = null;
  private socketPath: string;
  private reqId = 1;

  // Buffer state for onData: we track a read-offset into the buffer
  // string so that we only create a new (shorter) string when the
  // unconsumed tail grows too far from the start.
  private _buf = "";
  private _bufOffset = 0;

  // Reusable snapshot for snapshotState() — avoids a new object per call.
  private _snapshot: PlayerState = {
    url: null,
    title: null,
    paused: false,
    position: 0,
    duration: 0,
    volume: 80,
  };

  state: PlayerState = {
    url: null,
    title: null,
    paused: false,
    position: 0,
    duration: 0,
    volume: 80,
  };

  constructor(
    private mpvBin = "mpv",
    initialVolume = 100,
  ) {
    super();
    this.state.volume = Math.max(0, Math.min(100, initialVolume));
    // Control socket: named pipe on Windows, unix socket everywhere else.
    this.socketPath =
      process.platform === "win32"
        ? "\\\\.\\pipe\\catunes-mpv"
        : join(tmpdir(), `catunes-mpv-${process.pid}.sock`);

    // Bind once so we never create a new closure for the "data" listener.
    this._onDataBound = this._onData.bind(this);
  }

  // Bound handler — assigned in constructor, avoids per-connection closure.
  private _onDataBound: (chunk: Buffer | string) => void;

  /** Starts the mpv process and opens the control channel. */
  async start(): Promise<void> {
    // Make sure mpv's ytdl_hook can find our (possibly auto-downloaded)
    // yt-dlp by prepending catunes's bin dir to the child's PATH.
    // We assign PATH directly instead of spreading the entire process.env
    // object, which would allocate a large shallow copy on every start().
    const env = Object.assign(Object.create(null), process.env) as NodeJS.ProcessEnv;
    env.PATH = `${YTDLP_DIR}${delimiter}${process.env.PATH ?? ""}`;

    this.proc = spawn(
      this.mpvBin,
      [
        "--idle=yes",
        "--no-video",
        "--no-terminal",
        "--really-quiet",
        `--volume=${this.state.volume}`,
        `--input-ipc-server=${this.socketPath}`,
      ],
      { stdio: "ignore", env },
    );

    this.proc.on("exit", () => this.emit("exit"));

    await this.connectSocket();
    // We subscribe to changes on the properties we care about.
    this.observe("time-pos", 1);
    this.observe("duration", 2);
    this.observe("pause", 3);
    this.observe("volume", 4);
    this.observe("media-title", 5);
  }

  /** Connects to the mpv socket, retrying until mpv creates it. */
  private connectSocket(retries = 50): Promise<void> {
    return new Promise((resolve, reject) => {
      const attempt = (left: number) => {
        const sock = createConnection(this.socketPath);
        sock.on("connect", () => {
          this.socket = sock;
          sock.on("data", this._onDataBound);
          resolve();
        });
        sock.on("error", () => {
          if (left <= 0) return reject(new Error("No se pudo conectar a mpv"));
          setTimeout(() => attempt(left - 1), 100);
        });
      };
      attempt(retries);
    });
  }

  /** Processes the JSON lines emitted by mpv (events and responses). */
  private _onData(chunk: Buffer | string) {
    this._buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");

    let nl: number;
    while ((nl = this._buf.indexOf("\n", this._bufOffset)) >= 0) {
      // Extract only the current line — the offset lets us skip already-
      // processed bytes without re-slicing the whole buffer each time.
      const line = this._buf.substring(this._bufOffset, nl).trim();
      this._bufOffset = nl + 1;
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.event === "property-change") {
          this.onProperty(msg.name, msg.data);
        } else if (msg.event === "end-file") {
          // reason: "eof" (finished), "stop"/"quit" (we triggered it), "error"
          this.emit("ended", msg.reason as string, msg.file_error as
            | string
            | undefined);
        }
      } catch {
        // non-JSON line: ignore it
      }
    }

    // Compact the buffer: discard already-processed bytes when the
    // consumed portion exceeds 4 KB to keep memory bounded.
    if (this._bufOffset > 4096) {
      this._buf = this._buf.slice(this._bufOffset);
      this._bufOffset = 0;
    }
  }

  private onProperty(name: string, data: unknown) {
    switch (name) {
      case "time-pos":
        this.state.position = typeof data === "number" ? data : 0;
        break;
      case "duration":
        this.state.duration = typeof data === "number" ? data : 0;
        break;
      case "pause":
        this.state.paused = Boolean(data);
        break;
      case "volume":
        this.state.volume = typeof data === "number" ? data : this.state.volume;
        break;
      case "media-title":
        this.state.title = typeof data === "string" ? data : this.state.title;
        break;
    }
    this.emit("state", this.state);
  }

  private send(cmd: MpvCommand) {
    if (!this.socket) return;
    this.socket.write(JSON.stringify(cmd) + "\n");
  }

  /** Sends a command using the reusable _sendBuf to reduce allocations. */
  private sendArgs(...args: unknown[]) {
    if (!this.socket) return;
    _sendBuf.command = args;
    this.socket.write(JSON.stringify(_sendBuf) + "\n");
  }

  private observe(property: string, id: number) {
    this.sendArgs("observe_property", id, property);
  }

  /**
   * Returns a shallow copy of the current state. Reuses a single
   * internal snapshot object so callers like React's setState() do
   * not allocate a fresh object on every 90 ms tick.
   *
   * NOTE: the returned reference is always the same object — React's
   * useState will still trigger a re-render because setState() is
   * called unconditionally, and the object's *contents* change.
   */
  snapshotState(): PlayerState {
    const s = this._snapshot;
    const st = this.state;
    s.url = st.url;
    s.title = st.title;
    s.paused = st.paused;
    s.position = st.position;
    s.duration = st.duration;
    s.volume = st.volume;
    return s;
  }

  // --- Public API (used by the keyboard or the room) ---

  /** Loads and plays a URL or file path. */
  load(url: string) {
    this.state.url = url;
    this.state.title = url;
    this.sendArgs("loadfile", url, "replace");
    this.setPause(false);
    this.emit("state", this.state);
  }

  togglePause() {
    this.setPause(!this.state.paused);
  }

  setPause(paused: boolean) {
    this.sendArgs("set_property", "pause", paused);
  }

  /** Relative seek in seconds (negative = backward). */
  seek(seconds: number) {
    this.sendArgs("seek", seconds, "relative");
  }

  /** Absolute seek to a specific second (key for syncing rooms). */
  seekTo(seconds: number) {
    this.sendArgs("seek", seconds, "absolute");
  }

  setVolume(volume: number) {
    const v = Math.max(0, Math.min(100, volume));
    this.state.volume = v;
    this.sendArgs("set_property", "volume", v);
  }

  /**
   * Applies a 10-band graphic equalizer (gains in dB) via mpv's audio-filter
   * chain. All-zero gains clear the filter so there's no extra processing.
   */
  setEqualizer(gains: number[]) {
    this.sendArgs("set_property", "af", eqFilterChain(gains));
  }

  stop() {
    if (!this.socket) return;
    this.socket.write(_CMD_STOP);
  }

  quit() {
    if (this.socket) this.socket.write(_CMD_QUIT);
    this.socket?.end();
    this.proc?.kill();
  }
}
