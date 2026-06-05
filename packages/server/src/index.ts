// catunes relay server (rooms).
//
// It only forwards small TEXT messages between the members of a room
// ("play this url at second X", "it's your turn", chat...). It NEVER
// carries audio: each client plays locally. That's why it's dirt cheap.
//
// Initial skeleton: in-memory rooms + broadcast. Round-robin DJ rotation
// and fine-grained sync are built on top of this in phases 2/3.

const PORT = Number(process.env.PORT ?? 3000);

interface Member {
  id: string;
  name: string;
  ws: any; // Bun.ServerWebSocket
}

interface Room {
  code: string;
  members: Map<string, Member>;
  /** Cached roster array — invalidated on join/leave via _rosterDirty flag. */
  _rosterCache: { id: string; name: string }[];
  _rosterDirty: boolean;
}

const rooms = new Map<string, Room>();

type Incoming =
  | { type: "join"; room: string; name: string }
  | { type: "play"; url: string; position?: number }
  | { type: "pause"; paused: boolean }
  | { type: "chat"; text: string };

// Reusable roster payload object — avoids a new object literal per broadcast.
const _rosterPayload: { type: "roster"; members: { id: string; name: string }[] } = {
  type: "roster",
  members: [],
};

function broadcast(room: Room, payload: unknown, exceptId?: string) {
  const data = JSON.stringify(payload);
  for (const m of room.members.values()) {
    if (m.id !== exceptId) m.ws.send(data);
  }
}

/** Returns the cached roster array, rebuilding only when members changed. */
function roster(room: Room): { id: string; name: string }[] {
  if (room._rosterDirty) {
    const arr: { id: string; name: string }[] = [];
    for (const m of room.members.values()) {
      arr.push({ id: m.id, name: m.name });
    }
    room._rosterCache = arr;
    room._rosterDirty = false;
  }
  return room._rosterCache;
}

/** Broadcasts the roster using the shared payload object. */
function broadcastRoster(room: Room) {
  _rosterPayload.members = roster(room);
  broadcast(room, _rosterPayload);
}

function createRoom(code: string): Room {
  return { code, members: new Map(), _rosterCache: [], _rosterDirty: true };
}

const server = Bun.serve<{ id: string; room?: string }, {}>({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    // Upgrade to WebSocket
    const id = crypto.randomUUID();
    if (server.upgrade(req, { data: { id } })) return;
    return new Response("catunes relay — connect via WebSocket", { status: 426 });
  },
  websocket: {
    open(ws) {
      // Pre-build hello JSON via string concat — avoids allocating an object
      // just to stringify it immediately.
      ws.send('{"type":"hello","id":"' + ws.data.id + '"}');
    },
    message(ws, raw) {
      let msg: Incoming;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === "join") {
        let room = rooms.get(msg.room);
        if (!room) {
          room = createRoom(msg.room);
          rooms.set(msg.room, room);
        }
        room.members.set(ws.data.id, { id: ws.data.id, name: msg.name, ws });
        ws.data.room = msg.room;
        room._rosterDirty = true;
        broadcastRoster(room);
        return;
      }

      const room = ws.data.room ? rooms.get(ws.data.room) : undefined;
      if (!room) return;

      // For now: forward play/pause/chat to the rest of the room.
      switch (msg.type) {
        case "play":
          broadcast(room, { type: "play", url: msg.url, position: msg.position ?? 0 });
          break;
        case "pause":
          broadcast(room, { type: "pause", paused: msg.paused });
          break;
        case "chat":
          broadcast(room, { type: "chat", from: ws.data.id, text: msg.text });
          break;
      }
    },
    close(ws) {
      const room = ws.data.room ? rooms.get(ws.data.room) : undefined;
      if (!room) return;
      room.members.delete(ws.data.id);
      if (room.members.size === 0) rooms.delete(room.code);
      else {
        room._rosterDirty = true;
        broadcastRoster(room);
      }
    },
  },
});

console.log(`catunes relay listening on :${server.port}`);
