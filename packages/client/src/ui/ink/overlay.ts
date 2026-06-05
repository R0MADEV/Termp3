import type { SearchResult } from "../../playlist.ts";

export type Overlay =
  | { kind: "none" }
  | { kind: "settings" }
  | { kind: "theme" }
  | { kind: "lang" }
  | { kind: "playlists" }
  | { kind: "searchLimit" }
  | { kind: "help" }
  | { kind: "eq" }
  | { kind: "searchInput" }
  | { kind: "addInput"; target: "track" | "list" }
  | { kind: "searchResults"; results: SearchResult[] }
  | { kind: "confirmTrack"; index: number }
  | { kind: "confirmPlaylist"; name: string }
  | { kind: "loading"; text: string }
  | { kind: "searchProvider" };
