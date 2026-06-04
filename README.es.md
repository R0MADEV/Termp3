# catunes 🎵

> 🌍 [English](README.md) · **Español**

[![CI](https://github.com/R0MADEV/Termp3/actions/workflows/ci.yml/badge.svg)](https://github.com/R0MADEV/Termp3/actions/workflows/ci.yml)

Reproductor de música en terminal **retro**, con **salas sincronizadas**
y **rotación de DJ por turnos** — escuchad juntos, desde la terminal.

- 🎧 **Modo solo:** reproduce YouTube, radios, streams o archivos locales. Funciona sin servidor, incluso offline (archivos locales).
- 👥 **Modo sala (opcional):** entra a una sala con un código y escuchad lo mismo, sincronizado. Cada persona pincha **por turnos** (rotación en bucle).
- 🚫 **Sin descargar nada:** streaming puro. Sin Spotify Premium.
- 📊 **Visualizador reactivo real:** FFT en vivo (ffmpeg auto-instalado) con varios modos — barras, espejo, suave, osciloscopio, plasma (cambia con `v`).
- 🖥️ **Multiplataforma:** macOS, Linux y Windows.

> El núcleo es agnóstico de la fuente: YouTube es solo una opción más.

## Requisitos

- [mpv](https://mpv.io) — motor de audio (obligatorio).
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — solo para YouTube y similares.

Comprueba tu sistema con: `catunes doctor`

---

## 👤 Para usuarios — instala y escucha

```bash
npm install -g catunes
catunes play "https://www.youtube.com/watch?v=..."
```

Controles: `espacio` pausa · `← →` seek · `+ -` volumen · `q` salir.

---

### Ver y controlar desde cualquier pestaña 🎛️

No necesitas tmux ni zellij. Con un reproductor en marcha, desde cualquier panel:

```bash
catunes status     # qué suena ahora
catunes pause      # pausa / reanuda
catunes next       # siguiente
catunes vol +5     # volumen
```

Además, el **título del terminal** muestra el tema actual en cualquier terminal
(Warp lo enseña en la barra de pestañas). Guía: **[docs/now-playing.md](docs/now-playing.md)**

### Temas 🎨

Temas integrados (Green por defecto): elígelos en **Ajustes (`o`) → Tema**.
Crea el tuyo editando `~/.config/catunes/themes.json`:

```json
{
  "Ocean": { "accent": "cyan", "spectrum": ["blue", "cyan", "white"] }
}
```

`accent` es el color principal; `spectrum` son los colores grave/medio/agudo del
visualizador (nombres de color del terminal: green, yellow, red, cyan, blue…).

---

## 🛠️ Para desarrolladores — clona y corre

```bash
git clone https://github.com/<tu-usuario>/catunes
cd catunes
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
catunes play ... --relay ws://tu-servidor:3000
```

## Estructura

```
catunes/
├── packages/
│   ├── client/   # reproductor (TUI retro + mpv)  → nativo, npm/binario
│   └── server/   # relay de salas (WebSocket)     → Docker
└── docker-compose.yml
```

## Estado / Roadmap

- [x] Fase 0 — esqueleto + reproducir una URL en streaming
- [x] Fase 1 — TUI moderna en Ink (playlist, búsqueda, visualizador, temas, i18n, ahora-suena + control)
- [ ] Fase 2 — salas sincronizadas (WebSocket)
- [ ] Fase 3 — rotación de DJ por turnos
- [ ] Fase 4 — pulido, skins, binarios, publicación en npm

## Aviso legal

catunes **no** almacena ni convierte música — solo reproduce streams.
Úsalo únicamente con contenido que tengas derecho a reproducir y respetando
los términos de cada plataforma. El uso es responsabilidad de cada usuario.

Usa mpv y yt-dlp para leer el contenido; respeta el copyright y los términos de
cada sitio (como advierte el propio yt-dlp). Este proyecto no está diseñado para
descargar música ni para saltarse ninguna protección.

## Licencia

MIT
