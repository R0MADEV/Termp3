// Lightweight i18n for catunes.
//
// English is the default. Add a new language by adding its dictionary to
// MESSAGES. The active locale resolves from CATUNES_LANG, then the system
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
catunes v{version} — terminal music player

USAGE:
  catunes                Open the player interface with your playlist
  catunes add <url>      Add a URL to your playlist
  catunes play <url>     Play a single URL (line mode)
  catunes status         Print the "now playing"
  catunes setup          Download yt-dlp for your system (if needed)
  catunes config [k] [v] Show or change settings (lang, searchLimit)
  catunes doctor         Check dependencies (mpv, yt-dlp)

CONTROL FROM ANY TAB (with a player running):
  catunes pause          Pause / resume
  catunes next           Next track
  catunes prev           Previous track
  catunes vol +5         Raise/lower volume (+5 / -5)

NOW PLAYING IN ANY TERMINAL:
  While catunes plays, it updates the terminal TITLE (Warp shows it in the tab
  bar; iTerm/kitty/Windows Terminal in the title).
  catunes --help         Show this help

PLAYLIST:
  Edit your songs (one URL per line) at:
  {playlist}

CONTROLS (interface):
  ↑↓ navigate · ↵ play · space pause · ←→ seek · n/p next/prev · +/- vol · q quit
`,
    "err.mpvMissing": "\n❌ mpv is not installed.\n   {hint}\n",
    "err.ytdlpYoutube":
      "\n⚠️  This looks like a YouTube URL and yt-dlp is not installed.\n   {hint}\n",
    "err.missingUrlPlay": "Missing URL. Usage: catunes play <url>",
    "err.missingUrlAdd": "Missing URL. Usage: catunes add <url>",
    "err.unknownCmd": "Unknown command: {cmd}",
    "playlist.empty": "\nYour playlist is empty. Add URLs at:\n  {file}\n",
    "doctor.header": "\ncatunes doctor — dependency status:\n",
    "doctor.mpvOk": "  ✅ mpv      {version}",
    "doctor.mpvMissing": "  ❌ mpv      NOT found  →  {hint}",
    "doctor.ytOk": "  ✅ yt-dlp   {version}",
    "doctor.ytMissing":
      "  ⚠️  yt-dlp   not found  →  {hint}  (only needed for YouTube)",
    "doctor.ytDownloaded": "  ✅ yt-dlp   downloaded by catunes ({size} MB)",
    "doctor.ytAuto":
      "  ⚙️  yt-dlp   not installed — will auto-download on first use ({asset})",
    "doctor.ready": "\n  Ready to play. 🎵\n",
    "doctor.needMpv": "\n  Install mpv to be able to play.\n",
    "add.ok": "✅ Added to the playlist:\n   {url}",
    "add.skip": "⚠️  Not added ({reason}).",
    "reason.empty": "empty URL",
    "reason.duplicate": "already in the list",
    "ctl.noPlayer": "No active catunes player.",
    "vol.usage": "Usage: catunes vol +5  (or -5)",
    "play.goodbye": "\n👋 see you\n",
    "deps.installFallback": "Install {dep} from its official site.",
    "ui.noSong": "— no song —",
    "ui.loading": "⏳ Loading…",
    "ui.importing": "⏳ Importing playlist…",
    "ui.importedTo": "Imported {n} tracks → {name}",
    "ui.emptyHint": "Press / to search or a to add a track",
    "ui.resolving": "resolving",
    "ui.cantPlay": "⚠ Can't play: {title} — skipping",
    "ui.allFailed": "⚠ No track could be played (check your connection?)",
    "ui.playlist": " PLAYLIST · {n} tracks ",
    "ui.addLabel": " Add track ",
    "ui.addPrompt": "Paste a URL (YouTube, radio, stream) and press Enter:",
    "ui.importLabel": " New playlist ",
    "ui.importPrompt": "Paste a YouTube playlist URL (or a single URL) and press Enter:",
    "ui.deleteLabel": " Delete ",
    "ui.deleteConfirm": "Delete this track?  {title}",
    "ui.deletePlaylistConfirm": "Delete playlist and its tracks?  {name}",
    "ui.searchLabel": " Search YouTube ",
    "ui.searchPrompt": "Type a song or artist and press Enter:",
    "ui.searching": "Searching…",
    "ui.noResults": "No results.",
    "ui.resultsLabel": " Results — ↵ play · Esc cancel ",
    "ui.state.play": "PLAY",
    "ui.state.pause": "PAUSE",
    "ui.state.stop": "STOP",
    "ui.help":
      " {a}↑↓{/} nav  {a}↵{/} play  {a}space{/} pause  {a}n/p{/} next/prev  {a}/{/} search  {a}?{/} help  {a}q{/} quit",
    "ui.helpLabel": " Keys ",
    "ui.helpScreen": `  {a}Tab{/}      switch panel (tracks / playlists)
  {a}↑ ↓{/}      navigate
  {a}Enter{/}    play selected (or open playlist)
  {a}Space{/}    pause / resume
  {a}← →{/}      seek 5s
  {a}n / p{/}    next / previous
  {a}s{/}        shuffle on/off
  {a}r{/}        repeat (off / all / one)
  {a}/{/}        search YouTube
  {a}a{/}        add a URL
  {a}d{/}        delete selected
  {a}o{/}        settings (language, results)
  {a}+ / -{/}    volume
  {a}m{/}        mute
  {a}?{/}        this help
  {a}q{/}        quit

  {gray-fg}Esc to close{/}`,
    "ui.langLabel": " Language ",
    "ui.settingsLabel": " Settings ",
    "ui.optLanguage": "Language",
    "ui.optSearch": "Search results",
    "ui.optPlaylist": "Playlist",
    "ui.optTheme": "Theme",
    "ui.themesLabel": " Theme ",
    "ui.searchLimitLabel": " Search results ",
    "ui.resultsCount": "{n} results",
    "ui.playlistsLabel": " Playlists ",
  },
  es: {
    "help.body": `
catunes v{version} — reproductor de musica en terminal

USO:
  catunes                Abre la interfaz del reproductor con tu playlist
  catunes add <url>      Anade una URL a tu playlist
  catunes play <url>     Reproduce una URL suelta (modo linea)
  catunes status         Imprime el "ahora suena"
  catunes setup          Descarga yt-dlp para tu sistema (si hace falta)
  catunes config [k] [v] Ver o cambiar ajustes (lang, searchLimit)
  catunes doctor         Comprueba dependencias (mpv, yt-dlp)

CONTROL DESDE CUALQUIER PESTANA (con un reproductor en marcha):
  catunes pause          Pausa / reanuda
  catunes next           Siguiente cancion
  catunes prev           Cancion anterior
  catunes vol +5         Sube/baja el volumen (+5 / -5)

AHORA SUENA EN CUALQUIER TERMINAL:
  Mientras catunes reproduce, actualiza el TITULO del terminal (Warp lo muestra
  en la barra de pestanas; iTerm/kitty/Windows Terminal en el titulo).
  catunes --help         Muestra esta ayuda

PLAYLIST:
  Edita tus canciones (una URL por linea) en:
  {playlist}

CONTROLES (interfaz):
  ↑↓ navegar · ↵ play · espacio pausa · ←→ seek · n/p sig/ant · +/- vol · q salir
`,
    "err.mpvMissing": "\n❌ mpv no esta instalado.\n   {hint}\n",
    "err.ytdlpYoutube":
      "\n⚠️  Esta URL parece de YouTube y yt-dlp no esta instalado.\n   {hint}\n",
    "err.missingUrlPlay": "Falta la URL. Uso: catunes play <url>",
    "err.missingUrlAdd": "Falta la URL. Uso: catunes add <url>",
    "err.unknownCmd": "Comando desconocido: {cmd}",
    "playlist.empty": "\nTu playlist esta vacia. Anade URLs en:\n  {file}\n",
    "doctor.header": "\ncatunes doctor — estado de dependencias:\n",
    "doctor.mpvOk": "  ✅ mpv      {version}",
    "doctor.mpvMissing": "  ❌ mpv      NO encontrado  →  {hint}",
    "doctor.ytOk": "  ✅ yt-dlp   {version}",
    "doctor.ytMissing":
      "  ⚠️  yt-dlp   no encontrado  →  {hint}  (solo necesario para YouTube)",
    "doctor.ytDownloaded": "  ✅ yt-dlp   descargado por catunes ({size} MB)",
    "doctor.ytAuto":
      "  ⚙️  yt-dlp   no instalado — se descargará al primer uso ({asset})",
    "doctor.ready": "\n  Listo para reproducir. 🎵\n",
    "doctor.needMpv": "\n  Instala mpv para poder reproducir.\n",
    "add.ok": "✅ Anadida a la playlist:\n   {url}",
    "add.skip": "⚠️  No anadida ({reason}).",
    "reason.empty": "URL vacia",
    "reason.duplicate": "ya estaba en la lista",
    "ctl.noPlayer": "No hay un reproductor catunes activo.",
    "vol.usage": "Uso: catunes vol +5  (o -5)",
    "play.goodbye": "\n👋 hasta luego\n",
    "deps.installFallback": "Instala {dep} desde su web oficial.",
    "ui.noSong": "— sin cancion —",
    "ui.loading": "⏳ Cargando…",
    "ui.importing": "⏳ Importando playlist…",
    "ui.importedTo": "Importadas {n} canciones → {name}",
    "ui.emptyHint": "Pulsa / para buscar o a para anadir",
    "ui.resolving": "resolviendo",
    "ui.cantPlay": "⚠ No se puede reproducir: {title} — saltando",
    "ui.allFailed": "⚠ No se pudo reproducir nada (¿revisa tu conexion?)",
    "ui.playlist": " PLAYLIST · {n} temas ",
    "ui.addLabel": " Anadir cancion ",
    "ui.addPrompt": "Pega una URL (YouTube, radio, stream) y pulsa Enter:",
    "ui.importLabel": " Nueva lista ",
    "ui.importPrompt": "Pega una URL de playlist de YouTube (o una URL) y pulsa Enter:",
    "ui.deleteLabel": " Borrar ",
    "ui.deleteConfirm": "¿Borrar esta cancion?  {title}",
    "ui.deletePlaylistConfirm": "¿Borrar la lista y sus canciones?  {name}",
    "ui.searchLabel": " Buscar en YouTube ",
    "ui.searchPrompt": "Escribe una cancion o artista y pulsa Enter:",
    "ui.searching": "Buscando…",
    "ui.noResults": "Sin resultados.",
    "ui.resultsLabel": " Resultados — ↵ reproducir · Esc cancelar ",
    "ui.state.play": "PLAY",
    "ui.state.pause": "PAUSA",
    "ui.state.stop": "STOP",
    "ui.help":
      " {a}↑↓{/} nav  {a}↵{/} play  {a}espacio{/} pausa  {a}n/p{/} sig/ant  {a}/{/} buscar  {a}?{/} ayuda  {a}q{/} salir",
    "ui.helpLabel": " Teclas ",
    "ui.helpScreen": `  {a}Tab{/}      cambiar panel (canciones / listas)
  {a}↑ ↓{/}      navegar
  {a}Enter{/}    reproducir seleccionada (o abrir lista)
  {a}Espacio{/}  pausa / reanudar
  {a}← →{/}      avanzar/retroceder 5s
  {a}n / p{/}    siguiente / anterior
  {a}s{/}        aleatorio on/off
  {a}r{/}        repetir (off / todo / una)
  {a}/{/}        buscar en YouTube
  {a}a{/}        anadir una URL
  {a}d{/}        borrar seleccionada
  {a}o{/}        ajustes (idioma, resultados)
  {a}+ / -{/}    volumen
  {a}m{/}        silenciar
  {a}?{/}        esta ayuda
  {a}q{/}        salir

  {gray-fg}Esc para cerrar{/}`,
    "ui.langLabel": " Idioma ",
    "ui.settingsLabel": " Ajustes ",
    "ui.optLanguage": "Idioma",
    "ui.optSearch": "Resultados de busqueda",
    "ui.optPlaylist": "Lista",
    "ui.optTheme": "Tema",
    "ui.themesLabel": " Tema ",
    "ui.searchLimitLabel": " Resultados de busqueda ",
    "ui.resultsCount": "{n} resultados",
    "ui.playlistsLabel": " Listas ",
  },
};

let current: Locale | null = null;

/** Resolve the locale from CATUNES_LANG, the system LANG/LC_ALL, or default en. */
export function detectLocale(): Locale {
  const raw = (
    process.env.CATUNES_LANG ||
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
