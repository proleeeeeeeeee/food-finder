import type { Restaurant } from "@/lib/overpass";
import { fetchNearbyRestaurants, OverpassError } from "@/lib/overpass";
import { fetchGooglePlaces } from "@/lib/places";

// Headroom for the parallel Google+OSM fetch incl. Overpass mirror failover
// (normally ~2-3s). Keeps serverless hosts from killing a slow request early.
export const maxDuration = 20;

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
  return Response.json({ restaurants, source });
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
