# termp3 🎵

> 🌍 **English** · [Español](README.es.md)

[![CI](https://github.com/R0MADEV/Termp3/actions/workflows/ci.yml/badge.svg)](https://github.com/R0MADEV/Termp3/actions/workflows/ci.yml)

A **retro** terminal music player with **synced rooms** and
**turn-based DJ rotation** — listen together, right from your terminal.

- 🎧 **Solo mode:** play YouTube, radios, streams or local files. Works without a server, even offline (local files).
- 👥 **Room mode (optional):** join a room with a code and listen together, in sync. Everyone takes **turns** as DJ (round-robin).
- 🚫 **No downloads:** pure streaming. No Spotify Premium needed.
- 🖥️ **Cross-platform:** macOS, Linux and Windows.

> The core is source-agnostic: YouTube is just one option.

## Requirements

- [mpv](https://mpv.io) — audio engine (required).
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — only for YouTube and similar.

Check your system with: `termp3 doctor`

---

## 👤 For users — install and listen

```bash
npm install -g termp3        # or: bun add -g termp3
termp3 play "https://www.youtube.com/watch?v=..."
```

Controls: `space` pause · `← →` seek · `+ -` volume · `q` quit.

---

### See and control from any pane 🎛️

No tmux or zellij needed. With a player running, from any pane (tab):

```bash
termp3 status     # what's playing now
termp3 pause      # pause / resume
termp3 next       # next
termp3 vol +5     # volume
```

Also, the **terminal title** shows the current track in any terminal
(Warp shows it in the tab bar). Guide: **[docs/now-playing.md](docs/now-playing.md)**

---

## 🛠️ For developers — clone and run

```bash
git clone https://github.com/<your-user>/termp3
cd termp3
bun install

# Terminal 1 — rooms relay (Docker or native)
docker compose up            # or: bun run dev:server

# Terminal 2 — the player from source (native, with audio)
bun run dev:client doctor
bun run dev:client play "https://www.youtube.com/watch?v=..."
```

> The **client runs natively** (needs the speakers); the **relay runs in Docker**
> (headless, text only). Audio does NOT work inside Docker.

---

## 🏠 For self-hosting — your own rooms server

```bash
docker compose up -d                       # start the relay
termp3 play ... --relay ws://your-server:3000
```

## Structure

```
termp3/
├── packages/
│   ├── client/   # player (retro TUI + mpv)  → native, npm/binary
│   └── server/   # rooms relay (WebSocket)    → Docker
└── docker-compose.yml
```

## Status / Roadmap

- [x] Phase 0 — skeleton + stream a URL
- [x] Phase 1 — retro TUI (playlist, visualizer, titles, mini mode, now-playing + control, i18n)
- [ ] Phase 2 — synced rooms (WebSocket)
- [ ] Phase 3 — turn-based DJ rotation
- [ ] Phase 4 — polish, skins, binaries, npm release

## Disclaimer

termp3 is a generic player. Respect the terms of service of the platforms you
play; usage is each user's responsibility.

## License

MIT
