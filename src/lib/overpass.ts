// Talks to the OpenStreetMap Overpass API. No API key required.
// Runs server-side (imported by the route handler) so the browser never
// hits Overpass directly — keeps us in control of the query and rate limits.

export type Restaurant = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: string; // restaurant | fast_food | cafe
  cuisine?: string;
  openingHours?: string;
  website?: string;
  phone?: string;
  distance: number; // meters from the user
  // Google place id — lets the UI deep-link to the Maps place page (menu /
  // ratings / price / photos) without paying for those fields. OSM leaves unset.
  placeId?: string;
  // Dietary flags from OSM diet:* tags (sparse; Google rows leave them unset).
  halal?: boolean;
  vegetarian?: boolean;
};

// Public Overpass mirrors, tried in order: de is primary, the rest are failover
// for when it's rate-limiting or down.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** Carries the HTTP status so the route handler can tailor its message. */
export class OverpassError extends Error {
  constructor(public status: number) {
    super(`Overpass responded ${status}`);
    this.name = "OverpassError";
  }
}

/** Great-circle distance between two coordinates, in meters. */
export function haversine(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Params = { lat: number; lon: number; radius: number };

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export async function fetchNearbyRestaurants({
  lat,
  lon,
  radius,
}: Params): Promise<Restaurant[]> {
  // Cast a wide net over food-ish OSM tags — malls often tag outlets as shops or
  // food courts, not amenity=restaurant. Only named places (an unnamed node is
  // useless for "where to eat"). `nwr` = nodes + ways + relations.
  const query = `[out:json][timeout:25];
(
  nwr["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream)$"]["name"](around:${radius},${lat},${lon});
  nwr["shop"~"^(bakery|confectionery|pastry|coffee|tea|chocolate)$"]["name"](around:${radius},${lat},${lon});
);
out center 300;`;

  const elements = await queryOverpass(query);
  return normalize(elements, lat, lon);
}

const HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded",
  // Overpass rejects requests without a descriptive User-Agent (HTTP 406).
  "User-Agent": "FoodFinder/1.0 (nearby food picker demo)",
  Accept: "application/json",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Query Overpass with failover across mirrors + one retry on rate-limit/timeout.
// Each attempt is bounded by an AbortController so a hung mirror can't block.
async function queryOverpass(query: string): Promise<OverpassElement[]> {
  const body = "data=" + encodeURIComponent(query);
  let lastError: unknown = null;

  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: HEADERS,
          body,
          cache: "no-store",
          signal: controller.signal,
        });
        // 429 (rate limited) / 504 (gateway timeout) are worth one retry.
        if (res.status === 429 || res.status === 504) {
          lastError = new OverpassError(res.status);
          if (attempt === 0) {
            await sleep(1000);
            continue;
          }
          break; // give up on this mirror, fall through to the next
        }
        if (!res.ok) {
          lastError = new OverpassError(res.status);
          break;
        }
        const json = (await res.json()) as { elements?: OverpassElement[] };
        return json.elements ?? [];
      } catch (e) {
        lastError = e; // network error / abort — try the next mirror
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw lastError ?? new Error("All Overpass endpoints failed");
}

// Collapse the wider tag set back into the 3 UI categories.
function bucketOf(tags: Record<string, string>): string {
  const a = tags.amenity;
  const s = tags.shop;
  if (a === "fast_food" || a === "ice_cream" || s === "ice_cream")
    return "fast_food";
  if (
    a === "cafe" ||
    s === "bakery" ||
    s === "confectionery" ||
    s === "pastry" ||
    s === "coffee" ||
    s === "tea" ||
    s === "chocolate"
  )
    return "cafe";
  return "restaurant"; // restaurant, food_court, and anything else
}

function normalize(
  elements: OverpassElement[],
  lat: number,
  lon: number,
): Restaurant[] {
  const seen = new Set<string>();
  const list: Restaurant[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name;
    if (!name) continue;

    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (typeof elLat !== "number" || typeof elLon !== "number") continue;

    // Collapse duplicate names (chains with many branches) to the nearest one.
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    list.push({
      id: `${el.type}/${el.id}`,
      name,
      lat: elLat,
      lon: elLon,
      kind: bucketOf(tags),
      cuisine: tags.cuisine,
      openingHours: tags.opening_hours,
      website: tags.website ?? tags["contact:website"],
      phone: tags.phone ?? tags["contact:phone"],
      halal: tags["diet:halal"] === "yes" || tags["diet:halal"] === "only",
      vegetarian:
        tags["diet:vegetarian"] === "yes" ||
        tags["diet:vegetarian"] === "only" ||
        tags["diet:vegan"] === "yes" ||
        tags["diet:vegan"] === "only",
      distance: haversine(lat, lon, elLat, elLon),
    });
  }

  list.sort((a, b) => a.distance - b.distance);
  return list;
}
