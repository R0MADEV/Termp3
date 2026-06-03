# termp3 🎵

> 🌍 [English](README.md) · **Español**

[![CI](https://github.com/R0MADEV/Termp3/actions/workflows/ci.yml/badge.svg)](https://github.com/R0MADEV/Termp3/actions/workflows/ci.yml)

Reproductor de música en terminal **retro**, con **salas sincronizadas**
y **rotación de DJ por turnos** — escuchad juntos, desde la terminal.

- 🎧 **Modo solo:** reproduce YouTube, radios, streams o archivos locales. Funciona sin servidor, incluso offline (archivos locales).
- 👥 **Modo sala (opcional):** entra a una sala con un código y escuchad lo mismo, sincronizado. Cada persona pincha **por turnos** (rotación en bucle).
- 🚫 **Sin descargar nada:** streaming puro. Sin Spotify Premium.
- 🖥️ **Multiplataforma:** macOS, Linux y Windows.

> El núcleo es agnóstico de la fuente: YouTube es solo una opción más.

## Requisitos

- [mpv](https://mpv.io) — motor de audio (obligatorio).
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — solo para YouTube y similares.

Comprueba tu sistema con: `termp3 doctor`

---

## 👤 Para usuarios — instala y escucha

```bash
npm install -g termp3        # o: bun add -g termp3
termp3 play "https://www.youtube.com/watch?v=..."
```

Controles: `espacio` pausa · `← →` seek · `+ -` volumen · `q` salir.

---

### Ver y controlar desde cualquier pestaña 🎛️

No necesitas tmux ni zellij. Con un reproductor en marcha, desde cualquier panel:

```bash
termp3 status     # qué suena ahora
termp3 pause      # pausa / reanuda
termp3 next       # siguiente
termp3 vol +5     # volumen
```

Además, el **título del terminal** muestra el tema actual en cualquier terminal
(Warp lo enseña en la barra de pestañas). Guía: **[docs/now-playing.md](docs/now-playing.md)**

---

## 🛠️ Para desarrolladores — clona y corre

```bash
git clone https://github.com/<tu-usuario>/termp3
cd termp3
bun install

# Terminal 1 — relay de salas (Docker o nativo)
docker compose up            # ó: bun run dev:server

# Terminal 2 — el reproductor desde el código (nativo, con audio)
bun run dev:client doctor
bun run dev:client play "https://www.youtube.com/watch?v=..."
```

> El **cliente va nativo** (necesita los altavoces); el **relay va en Docker**
> (es headless, solo texto). El audio NO funciona dentro de Docker.

---

## 🏠 Para self-host — tu propio servidor de salas

```bash
docker compose up -d                       # levanta el relay
termp3 play ... --relay ws://tu-servidor:3000
```

## Estructura

```
termp3/
├── packages/
│   ├── client/   # reproductor (TUI retro + mpv)  → nativo, npm/binario
│   └── server/   # relay de salas (WebSocket)     → Docker
└── docker-compose.yml
```

## Estado / Roadmap

- [x] Fase 0 — esqueleto + reproducir una URL en streaming
- [x] Fase 1 — TUI retro (playlist, visualizador, títulos, modo mini, ahora-suena + control, i18n)
- [ ] Fase 2 — salas sincronizadas (WebSocket)
- [ ] Fase 3 — rotación de DJ por turnos
- [ ] Fase 4 — pulido, skins, binarios, publicación en npm

## Aviso legal

termp3 es un reproductor genérico. Respeta los términos de servicio de las
plataformas que reproduzcas; el uso es responsabilidad de cada usuario.

## Licencia

MIT
