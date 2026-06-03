// Lightweight i18n for termp3.
//
// English is the default. Add a new language by adding its dictionary to
// MESSAGES. The active locale resolves from TERMP3_LANG, then the system
// LANG/LC_ALL, then falls back to English.
//
// Usage:  t("doctor.header")   ·   t("add.ok", { url })

export type Locale = "en" | "es";
export const SUPPORTED_LOCALES: Locale[] = ["en", "es"];

/** Human-readable names shown in the in-app language picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

type Dict = Record<string, string>;

const MESSAGES: Record<Locale, Dict> = {
  en: {
    "help.body": `
termp3 v{version} — terminal music player

USAGE:
  termp3                Open the player interface with your playlist
  termp3 --mini [top]   Compact strip mode (floating), bottom by default
  termp3 add <url>      Add a URL to your playlist
  termp3 play <url>     Play a single URL (line mode)
  termp3 status         Print the "now playing"
  termp3 doctor         Check dependencies (mpv, yt-dlp)

CONTROL FROM ANY TAB (with a player running):
  termp3 pause          Pause / resume
  termp3 next           Next track
  termp3 prev           Previous track
  termp3 vol +5         Raise/lower volume (+5 / -5)

NOW PLAYING IN ANY TERMINAL:
  While termp3 plays, it updates the terminal TITLE (Warp shows it in the tab
  bar; iTerm/kitty/Windows Terminal in the title).
  termp3 --help         Show this help

PLAYLIST:
  Edit your songs (one URL per line) at:
  {playlist}

CONTROLS (interface):
  ↑↓ navigate · ↵ play · space pause · ←→ seek · n/p next/prev · +/- vol · q quit
`,
    "err.mpvMissing": "\n❌ mpv is not installed.\n   {hint}\n",
    "err.ytdlpYoutube":
      "\n⚠️  This looks like a YouTube URL and yt-dlp is not installed.\n   {hint}\n",
    "err.missingUrlPlay": "Missing URL. Usage: termp3 play <url>",
    "err.missingUrlAdd": "Missing URL. Usage: termp3 add <url>",
    "err.unknownCmd": "Unknown command: {cmd}",
    "playlist.empty": "\nYour playlist is empty. Add URLs at:\n  {file}\n",
    "doctor.header": "\ntermp3 doctor — dependency status:\n",
    "doctor.mpvOk": "  ✅ mpv      {version}",
    "doctor.mpvMissing": "  ❌ mpv      NOT found  →  {hint}",
    "doctor.ytOk": "  ✅ yt-dlp   {version}",
    "doctor.ytMissing":
      "  ⚠️  yt-dlp   not found  →  {hint}  (only needed for YouTube)",
    "doctor.ready": "\n  Ready to play. 🎵\n",
    "doctor.needMpv": "\n  Install mpv to be able to play.\n",
    "add.ok": "✅ Added to the playlist:\n   {url}",
    "add.skip": "⚠️  Not added ({reason}).",
    "reason.empty": "empty URL",
    "reason.duplicate": "already in the list",
    "ctl.noPlayer": "No active termp3 player.",
    "vol.usage": "Usage: termp3 vol +5  (or -5)",
    "play.goodbye": "\n👋 see you\n",
    "deps.installFallback": "Install {dep} from its official site.",
    "ui.noSong": "— no song —",
    "ui.resolving": "resolving",
    "ui.cantPlay": "⚠ Can't play: {title} — skipping",
    "ui.allFailed": "⚠ No track could be played (check your connection?)",
    "ui.playlist": " PLAYLIST · {n} tracks ",
    "ui.addLabel": " Add URL ",
    "ui.addPrompt": "Paste a URL (YouTube, radio, stream) and press Enter:",
    "ui.state.play": "PLAY",
    "ui.state.pause": "PAUSE",
    "ui.state.stop": "STOP",
    "ui.help":
      " {green-fg}↑↓{/} navigate  {green-fg}↵{/} play  {green-fg}space{/} pause  {green-fg}←→{/} seek  {green-fg}n/p{/} next/prev  {green-fg}a{/} add  {green-fg}l{/} lang  {green-fg}+/-{/} vol  {green-fg}q{/} quit",
    "ui.langLabel": " Language ",
  },
  es: {
    "help.body": `
termp3 v{version} — reproductor de musica en terminal

USO:
  termp3                Abre la interfaz del reproductor con tu playlist
  termp3 --mini [top]   Modo tira compacta (flotante), abajo por defecto
  termp3 add <url>      Anade una URL a tu playlist
  termp3 play <url>     Reproduce una URL suelta (modo linea)
  termp3 status         Imprime el "ahora suena"
  termp3 doctor         Comprueba dependencias (mpv, yt-dlp)

CONTROL DESDE CUALQUIER PESTANA (con un reproductor en marcha):
  termp3 pause          Pausa / reanuda
  termp3 next           Siguiente cancion
  termp3 prev           Cancion anterior
  termp3 vol +5         Sube/baja el volumen (+5 / -5)

AHORA SUENA EN CUALQUIER TERMINAL:
  Mientras termp3 reproduce, actualiza el TITULO del terminal (Warp lo muestra
  en la barra de pestanas; iTerm/kitty/Windows Terminal en el titulo).
  termp3 --help         Muestra esta ayuda

PLAYLIST:
  Edita tus canciones (una URL por linea) en:
  {playlist}

CONTROLES (interfaz):
  ↑↓ navegar · ↵ play · espacio pausa · ←→ seek · n/p sig/ant · +/- vol · q salir
`,
    "err.mpvMissing": "\n❌ mpv no esta instalado.\n   {hint}\n",
    "err.ytdlpYoutube":
      "\n⚠️  Esta URL parece de YouTube y yt-dlp no esta instalado.\n   {hint}\n",
    "err.missingUrlPlay": "Falta la URL. Uso: termp3 play <url>",
    "err.missingUrlAdd": "Falta la URL. Uso: termp3 add <url>",
    "err.unknownCmd": "Comando desconocido: {cmd}",
    "playlist.empty": "\nTu playlist esta vacia. Anade URLs en:\n  {file}\n",
    "doctor.header": "\ntermp3 doctor — estado de dependencias:\n",
    "doctor.mpvOk": "  ✅ mpv      {version}",
    "doctor.mpvMissing": "  ❌ mpv      NO encontrado  →  {hint}",
    "doctor.ytOk": "  ✅ yt-dlp   {version}",
    "doctor.ytMissing":
      "  ⚠️  yt-dlp   no encontrado  →  {hint}  (solo necesario para YouTube)",
    "doctor.ready": "\n  Listo para reproducir. 🎵\n",
    "doctor.needMpv": "\n  Instala mpv para poder reproducir.\n",
    "add.ok": "✅ Anadida a la playlist:\n   {url}",
    "add.skip": "⚠️  No anadida ({reason}).",
    "reason.empty": "URL vacia",
    "reason.duplicate": "ya estaba en la lista",
    "ctl.noPlayer": "No hay un reproductor termp3 activo.",
    "vol.usage": "Uso: termp3 vol +5  (o -5)",
    "play.goodbye": "\n👋 hasta luego\n",
    "deps.installFallback": "Instala {dep} desde su web oficial.",
    "ui.noSong": "— sin cancion —",
    "ui.resolving": "resolviendo",
    "ui.cantPlay": "⚠ No se puede reproducir: {title} — saltando",
    "ui.allFailed": "⚠ No se pudo reproducir nada (¿revisa tu conexion?)",
    "ui.playlist": " PLAYLIST · {n} temas ",
    "ui.addLabel": " Anadir URL ",
    "ui.addPrompt": "Pega una URL (YouTube, radio, stream) y pulsa Enter:",
    "ui.state.play": "PLAY",
    "ui.state.pause": "PAUSA",
    "ui.state.stop": "STOP",
    "ui.help":
      " {green-fg}↑↓{/} navegar  {green-fg}↵{/} play  {green-fg}espacio{/} pausa  {green-fg}←→{/} seek  {green-fg}n/p{/} sig/ant  {green-fg}a{/} anadir  {green-fg}l{/} idioma  {green-fg}+/-{/} vol  {green-fg}q{/} salir",
    "ui.langLabel": " Idioma ",
  },
};

let current: Locale | null = null;

/** Resolve the locale from TERMP3_LANG, the system LANG/LC_ALL, or default en. */
export function detectLocale(): Locale {
  const raw = (
    process.env.TERMP3_LANG ||
    process.env.LANG ||
    process.env.LC_ALL ||
    ""
  ).toLowerCase();
  const match = SUPPORTED_LOCALES.find((l) => raw.startsWith(l));
  return match ?? "en";
}

export function setLocale(loc: Locale): void {
  current = loc;
}

export function getLocale(): Locale {
  if (!current) current = detectLocale();
  return current;
}

/** Translate a key, interpolating {placeholders} from vars. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const loc = getLocale();
  let str = MESSAGES[loc][key] ?? MESSAGES.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
