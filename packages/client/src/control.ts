// catunes control socket.
//
// The running player opens a socket; `catunes pause/next/prev/vol` connect
// to it and send commands. This lets you control the music from ANY
// tab/pane without switching back to the player window.
//
// (Same pattern we'll use in Phase 2 so that rooms can drive the
//  player: a single point of control over playback.)

import { createServer, createConnection, type Server } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { CONTROL_SOCKET } from "./config.ts";

export interface ControlHandlers {
  pause: () => void;
  next: () => void;
  prev: () => void;
  volume: (delta: number) => void;
  stop?: () => void;
}

interface ControlMsg {
  cmd: "pause" | "next" | "prev" | "vol" | "stop";
  delta?: number;
}

function dispatch(msg: ControlMsg, h: ControlHandlers) {
  switch (msg.cmd) {
    case "pause":
      h.pause();
      break;
    case "next":
      h.next();
      break;
    case "prev":
      h.prev();
      break;
    case "vol":
      h.volume(Number(msg.delta) || 0);
      break;
    case "stop":
      h.stop?.();
      break;
  }
}

/** Starts the control server (called by the player process). */
export function startControlServer(handlers: ControlHandlers): Server {
  // Clean up a stale socket (on unix; on Windows the named pipe is managed automatically).
  if (process.platform !== "win32") {
    try {
      if (existsSync(CONTROL_SOCKET)) unlinkSync(CONTROL_SOCKET);
    } catch {
      // ignore
    }
  }

  const server = createServer((sock) => {
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          dispatch(JSON.parse(line) as ControlMsg, handlers);
          sock.write(JSON.stringify({ ok: true }) + "\n");
        } catch {
          sock.write(JSON.stringify({ ok: false }) + "\n");
        }
      }
    });
    sock.on("error", () => {});
  });

  server.on("error", () => {});
  server.listen(CONTROL_SOCKET);

  const cleanup = () => {
    if (process.platform !== "win32") {
      try {
        unlinkSync(CONTROL_SOCKET);
      } catch {
        // ignore
      }
    }
  };
  process.on("exit", cleanup);
  return server;
}

/**
 * Sends a command to the running player. Returns false if there is none
 * (the socket doesn't exist or doesn't respond).
 */
export function sendControl(msg: ControlMsg, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const sock = createConnection(CONTROL_SOCKET);
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.on("connect", () => sock.write(JSON.stringify(msg) + "\n"));
    sock.on("data", () => finish(true));
    sock.on("error", () => finish(false));
    setTimeout(() => finish(false), timeoutMs);
  });
}
