// Internet-radio directory via the free community radio-browser.info API.
// No key, no backend — we search by name and by tag (genre) and merge results.

export interface RadioStation {
  name: string;
  url: string;
  country: string;
  codec: string;
  bitrate: number;
}

// Several mirrors for failover; the API asks clients to send a User-Agent.
const HOSTS = [
  "https://de1.api.radio-browser.info",
  "https://de2.api.radio-browser.info",
  "https://nl1.api.radio-browser.info",
];
const UA = "catunes (https://github.com/R0MADEV/catunes)";

async function fetchJson(path: string): Promise<unknown[] | null> {
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      return (await res.json()) as unknown[];
    } catch {
      // try the next mirror
    }
  }
  return null;
}

/** Searches stations by name, country and genre/tag, most-popular first (deduped). */
export async function searchRadios(
  query: string,
  limit = 80,
): Promise<RadioStation[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const common = `order=clickcount&reverse=true&hidebroken=true&limit=${limit}`;
  const seen = new Set<string>();
  const out: RadioStation[] = [];
  // name first (most specific), then country (e.g. "peru"), then genre/tag.
  // bycountry/* does a partial, case-insensitive country-name match.
  for (const path of [
    `/json/stations/search?name=${q}&${common}`,
    `/json/stations/bycountry/${q}?${common}`,
    `/json/stations/search?tag=${q}&${common}`,
  ]) {
    if (out.length >= limit) break;
    const arr = await fetchJson(path);
    if (!arr) continue;
    for (const s of arr as Record<string, unknown>[]) {
      const url = String(s.url_resolved || s.url || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({
        name: String(s.name || url).trim().replace(/\s+/g, " "),
        url,
        country: String(s.countrycode || ""),
        codec: String(s.codec || ""),
        bitrate: Number(s.bitrate) || 0,
      });
      if (out.length >= limit) break;
    }
  }
  return out;
}
