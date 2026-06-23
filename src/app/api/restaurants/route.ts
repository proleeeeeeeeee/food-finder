import type { Restaurant } from "@/lib/overpass";
import { fetchNearbyRestaurants, OverpassError } from "@/lib/overpass";
import { fetchGooglePlaces } from "@/lib/places";

// Headroom for the parallel Google+OSM fetch incl. Overpass mirror failover
// (normally ~2-3s). Keeps serverless hosts from killing a slow request early.
export const maxDuration = 20;

// ---- in-memory response cache ----
// Cuts repeat Google/Overpass calls: the same area (rounded to ~110m) + radius
// within the TTL is served from memory instead of hitting the upstreams again.
// Module-scoped, so it survives across requests on a WARM serverless instance
// (lost on cold start, not shared across instances — for persistent/shared
// caching, upgrade to Vercel KV / Upstash Redis later). Cached distances are
// relative to the first requester's point in the cell (≤~110m off for others;
// exact for the same user re-searching the same spot).
type CacheEntry = { restaurants: Restaurant[]; source: string; expires: number };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — POIs change slowly
const CACHE_MAX = 300;

function cacheKey(lat: number, lon: number, radius: number) {
  return `${lat.toFixed(3)},${lon.toFixed(3)},${radius}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const rawRadius = Number(searchParams.get("radius") ?? "1500");

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "缺少有效的经纬度" }, { status: 400 });
  }

  const radius = Math.min(
    Math.max(Number.isFinite(rawRadius) ? rawRadius : 1500, 200),
    5000,
  );

  // Cache hit → skip all upstream calls.
  const ck = cacheKey(lat, lon, radius);
  const hit = CACHE.get(ck);
  if (hit && hit.expires > Date.now()) {
    return Response.json({
      restaurants: hit.restaurants,
      source: hit.source,
      cached: true,
    });
  }

  // Hybrid: fetch Google (when a key is set) AND OSM in parallel, then merge +
  // dedupe. Google contributes its (≤20) high-quality/mall results; OSM adds
  // breadth. Still only ONE Google call per search — OSM is free. If Google
  // fails (quota/billing/network) we just keep OSM, so the site never goes down.
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const [googleRes, osmRes] = await Promise.allSettled([
    key ? fetchGooglePlaces({ lat, lon, radius, key }) : Promise.resolve([]),
    fetchNearbyRestaurants({ lat, lon, radius }),
  ]);

  const google = googleRes.status === "fulfilled" ? googleRes.value : [];
  const osm = osmRes.status === "fulfilled" ? osmRes.value : [];
  if (googleRes.status === "rejected")
    console.warn("Google Places failed → OSM only:", googleRes.reason);

  if (google.length === 0 && osm.length === 0) {
    const reason = osmRes.status === "rejected" ? osmRes.reason : null;
    const rateLimited = reason instanceof OverpassError && reason.status === 429;
    if (osmRes.status === "rejected") console.error("overpass error", reason);
    return Response.json(
      {
        error: rateLimited
          ? "请求太频繁，请等几秒再试"
          : "美食数据源暂时不可用，请稍后再试",
      },
      { status: 502 },
    );
  }

  const restaurants = mergeSources(google, osm);
  const source = google.length
    ? osm.length
      ? "google+osm"
      : "google"
    : "osm";

  CACHE.set(ck, { restaurants, source, expires: Date.now() + CACHE_TTL_MS });
  if (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }

  return Response.json({ restaurants, source, cached: false });
}

// Combine both sources, dropping duplicate names (Google wins — better data),
// then sort by distance.
function mergeSources(google: Restaurant[], osm: Restaurant[]): Restaurant[] {
  const seen = new Set<string>();
  const out: Restaurant[] = [];
  for (const r of [...google, ...osm]) {
    const key = r.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}
