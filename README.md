# catunes 🎵

> 🌍 **English** · [Español](README.es.md)

[![CI](https://github.com/R0MADEV/catunes/actions/workflows/ci.yml/badge.svg)](https://github.com/R0MADEV/catunes/actions/workflows/ci.yml)

A **retro** terminal music player with **synced rooms** and
**turn-based DJ rotation** — listen together, right from your terminal.

- 🎧 **Solo mode:** play YouTube, radios, streams or local files. Works without a server, even offline (local files).
- 👥 **Room mode (optional):** join a room with a code and listen together, in sync. Everyone takes **turns** as DJ (round-robin).
- 🚫 **No downloads:** pure streaming. No Spotify Premium needed.
- 📊 **Real audio-reactive visualizer:** live FFT (auto-installed ffmpeg) with several modes — bars, mirror, smooth, oscilloscope, plasma (cycle with `v`).
- 🖥️ **Cross-platform:** macOS, Linux and Windows.

> The core is source-agnostic: YouTube is just one option.

## Requirements

- [mpv](https://mpv.io) — audio engine (required).
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — only for YouTube and similar.
- [gamdl](https://github.com/glomatico/gamdl) — only for Apple Music.

> **Note on Apple Music:**
> To use Apple Music, you need to provide your authentication cookies inside the UI using the command `/auth <cookies>`.
> This project also relies on a custom fork of `applemusic-api` to fetch metadata and search the Apple catalog.

Check your system with: `catunes doctor`

---

## 👤 For users — install and listen

```bash
npm install -g catunes
catunes play "https://www.youtube.com/watch?v=..."
```

Controls: `space` pause · `← →` seek · `+ -` volume · `q` quit.

---

### See and control from any pane 🎛️

No tmux or zellij needed. With a player running, from any pane (tab):

```bash
catunes status     # what's playing now
catunes pause      # pause / resume
catunes next       # next
catunes vol +5     # volume
```

Also, the **terminal title** shows the current track in any terminal
(Warp shows it in the tab bar). Guide: **[docs/now-playing.md](docs/now-playing.md)**

### Themes 🎨

Built-in themes (Green by default): pick one in **Settings (`o`) → Theme**.
Create your own by editing `~/.config/catunes/themes.json`:

```json
{
  "Ocean": { "accent": "cyan", "spectrum": ["blue", "cyan", "white"] }
}
```

`accent` is the main color; `spectrum` is the visualizer's low/mid/high colors
(terminal color names: green, yellow, red, cyan, blue, magenta, white…).

---

## 🛠️ For developers — clone and run

```bash
git clone https://github.com/<your-user>/catunes
cd catunes
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
catunes play ... --relay ws://your-server:3000
```

## Structure

```
catunes/
├── packages/
│   ├── client/   # player (retro TUI + mpv)  → native, npm/binary
│   └── server/   # rooms relay (WebSocket)    → Docker
└── docker-compose.yml
```

## Status / Roadmap

- [x] Phase 0 — skeleton + stream a URL
- [x] Phase 1 — modern TUI in Ink (playlist, search, visualizer, themes, i18n, now-playing + control)
- [ ] Phase 2 — synced rooms (WebSocket)
- [ ] Phase 3 — turn-based DJ rotation
- [ ] Phase 4 — polish, skins, binaries, npm release

## Disclaimer

catunes does **not** download, store or convert music — it only plays streams.
Use it only with content you have the right to play, and respect each
platform's terms of service. How you use it is your responsibility.

It relies on mpv and yt-dlp to read media; respect copyright and the terms of
each site (as yt-dlp itself advises). This project is not designed to download
music or to circumvent any protection.

## License

MIT
