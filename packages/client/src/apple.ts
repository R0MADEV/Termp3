import { AppleMusic, getAuthenticatedAxios, ResourceType } from "applemusic-api";
import axiosManager from "applemusic-api/dist/utils/AxiosManager.js";
import { loadSettings } from "./config.ts";
import type { SearchResult, Track } from "./playlist.ts";

interface CookieJarLike {
  setCookieSync(cookie: string, url: string): unknown;
}

let client: AppleMusic | null = null;

export async function getAppleClient(): Promise<AppleMusic> {
  if (client) return client;

  const settings = loadSettings();
  if (settings.appleCookies) {
    applyAppleCookies(settings.appleCookies);
  }

  client = new AppleMusic();
  await client.init();

  // Re-apply after init: the library's getInstance() replaces the cookiejar
  // when it fetches a new token, so cookies set before init are lost.
  if (settings.appleCookies) {
    applyAppleCookies(settings.appleCookies);
  }

  return client;
}

function getCookieJar(): CookieJarLike {
  return (axiosManager as unknown as { cookiejar: CookieJarLike }).cookiejar;
}

export function applyAppleCookies(cookieString: string): void {
  const jar = getCookieJar();
  const rawCookies = cookieString.split(";").map((c) => c.trim()).filter(Boolean);
  for (const raw of rawCookies) {
    const eq = raw.indexOf("=");
    if (eq < 0) continue;
    const name = raw.slice(0, eq).trim();
    const value = raw.slice(eq + 1).trim();
    const setCookieStr = `${name}=${value}; Domain=.music.apple.com; Path=/`;
    jar.setCookieSync(setCookieStr, "https://music.apple.com");
    jar.setCookieSync(setCookieStr, "https://amp-api-edge.music.apple.com");
  }
}

export function resetAppleClient(): void {
  client = null;
}

function buildAppleMusicUrl(id: string, attributes?: { url?: string }): string {
  if (attributes?.url) {
    // Ensure the URL has the proper scheme and storefront prefix.
    const u = attributes.url.startsWith("http") ? attributes.url : `https://music.apple.com${attributes.url}`;
    // Gamdl needs a storefront in the URL path. If the API returned a URL
    // without one (unlikely but possible), insert the default "us" storefront.
    if (!/music\.apple\.com\/[a-z]{2}\//.test(u)) {
      return u.replace("music.apple.com/", "music.apple.com/us/");
    }
    return u;
  }
  // Library items have IDs like "i.abc123" or "l.abc123".
  if (/^[pli]\./.test(id)) {
    return `https://music.apple.com/us/library/songs/${id}`;
  }
  // Catalog items have numeric IDs.
  return `https://music.apple.com/us/song/${id}`;
}

export async function searchApple(query: string): Promise<SearchResult[]> {
  const am = await getAppleClient();
  const results = await am.Search.search({ term: query, types: [ResourceType.Songs] });
  return (results.results.songs?.data || []).map((song) => ({
    title: song.attributes?.name || "Unknown",
    artist: song.attributes?.artistName || "Unknown",
    url: buildAppleMusicUrl(song.id, song.attributes),
    duration: Math.floor((song.attributes?.durationInMillis || 0) / 1000),
  }));
}

export async function getLibrarySongs(): Promise<Track[]> {
  await getAppleClient();
  const axios = await getAuthenticatedAxios();
  const res = await axios.get<{ data: Array<{ id: string; attributes?: { name?: string; artistName?: string; durationInMillis?: number; url?: string } }> }>(
    "https://amp-api-edge.music.apple.com/v1/me/library/songs",
  );
  if (!res.data?.data) return [];
  return res.data.data.map((song) => ({
    title: song.attributes?.name || "Unknown",
    artist: song.attributes?.artistName || "Unknown",
    url: buildAppleMusicUrl(song.id, song.attributes),
    duration: Math.floor((song.attributes?.durationInMillis || 0) / 1000),
    resolved: true,
  }));
}
