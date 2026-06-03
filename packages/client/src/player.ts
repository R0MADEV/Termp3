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

export interface PlayerState {
  url: string | null;
  title: string | null;
  paused: boolean;
  position: number; // seconds
  duration: number; // seconds
  volume: number; // 0-100
}

type MpvCommand = { command: unknown[]; request_id?: number };

export class Player extends EventEmitter {
  private proc: ChildProcess | null = null;
  private socket: Socket | null = null;
  private socketPath: string;
  private reqId = 1;
  private buffer = "";

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
    initialVolume = 80,
  ) {
    super();
    this.state.volume = Math.max(0, Math.min(150, initialVolume));
    // Control socket: named pipe on Windows, unix socket everywhere else.
    this.socketPath =
      process.platform === "win32"
        ? "\\\\.\\pipe\\termp3-mpv"
        : join(tmpdir(), `termp3-mpv-${process.pid}.sock`);
  }

  /** Starts the mpv process and opens the control channel. */
  async start(): Promise<void> {
    // Make sure mpv's ytdl_hook can find our (possibly auto-downloaded)
    // yt-dlp by prepending termp3's bin dir to the child's PATH.
    const env = {
      ...process.env,
      PATH: `${YTDLP_DIR}${delimiter}${process.env.PATH ?? ""}`,
    };

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
          sock.on("data", (chunk) => this.onData(chunk));
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
  private onData(chunk: Buffer | string) {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
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

  private observe(property: string, id: number) {
    this.send({ command: ["observe_property", id, property] });
  }

  // --- Public API (used by the keyboard or the room) ---

  /** Loads and plays a URL or file path. */
  load(url: string) {
    this.state.url = url;
    this.state.title = url;
    this.send({ command: ["loadfile", url, "replace"] });
    this.setPause(false);
    this.emit("state", this.state);
  }

  togglePause() {
    this.setPause(!this.state.paused);
  }

  setPause(paused: boolean) {
    this.send({ command: ["set_property", "pause", paused] });
  }

  /** Relative seek in seconds (negative = backward). */
  seek(seconds: number) {
    this.send({ command: ["seek", seconds, "relative"] });
  }

  /** Absolute seek to a specific second (key for syncing rooms). */
  seekTo(seconds: number) {
    this.send({ command: ["seek", seconds, "absolute"] });
  }

  setVolume(volume: number) {
    const v = Math.max(0, Math.min(150, volume));
    this.state.volume = v;
    this.send({ command: ["set_property", "volume", v] });
  }

  stop() {
    this.send({ command: ["stop"] });
  }

  quit() {
    this.send({ command: ["quit"] });
    this.socket?.end();
    this.proc?.kill();
  }
}
