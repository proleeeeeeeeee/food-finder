// Google Places API (New) — Nearby Search. Optional, richer source than OSM
// (full mall/indoor coverage). Used server-side only; the API key never reaches
// the browser.
//
// Cost: we request ONLY the cheap "Nearby Search Pro" SKU fields (~5,000 free
// calls/month). Ratings / price / hours / photos are deliberately NOT fetched
// (they'd jump to the pricier "Atmosphere" SKU, ~1,000/month). Instead the UI
// deep-links to the Google Maps place page, where the user sees all of that for
// free — built from just the place id (a Pro-tier field).

import { haversine, type Restaurant } from "@/lib/overpass";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.businessStatus",
].join(",");
// Nearby Search returns at most 20 results per call (no pagination).
const MAX_RESULTS = 20;
const INCLUDED_TYPES = [
  "restaurant",
  "cafe",
  "bakery",
  "meal_takeaway",
  "ice_cream_shop",
];

type Params = { lat: number; lon: number; radius: number; key: string };

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
};

export async function fetchGooglePlaces({
  lat,
  lon,
  radius,
  key,
}: Params): Promise<Restaurant[]> {
  const body = {
    includedTypes: INCLUDED_TYPES,
    maxResultCount: MAX_RESULTS,
    // Return the 20 NEAREST (not the 20 most "popular"), so they're actually
    // around the user and the distance slider behaves predictably.
    rankPreference: "DISTANCE",
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lon },
        radius: Math.min(radius, 50000),
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // Any non-2xx (incl. 429 quota / 403 billing) throws so the route falls back
  // to free OSM data.
  if (!res.ok) throw new Error(`Google Places responded ${res.status}`);

  const json = (await res.json()) as { places?: GooglePlace[] };
  const list: Restaurant[] = [];
  for (const p of json.places ?? []) {
    const name = p.displayName?.text;
    const plat = p.location?.latitude;
    const plon = p.location?.longitude;
    if (!name || typeof plat !== "number" || typeof plon !== "number") continue;
    // Skip permanently/temporarily closed places — don't suggest those.
    if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;

    list.push({
      id: `google/${p.id ?? `${plat},${plon}`}`,
      name,
      lat: plat,
      lon: plon,
      kind: bucketOf(p.types, p.primaryType),
      cuisine: cuisineFromType(p.primaryType, p.types),
      placeId: p.id,
      distance: haversine(lat, lon, plat, plon),
    });
  }
  list.sort((a, b) => a.distance - b.distance);
  return list;
}

// Collapse Google place types into our 3 UI categories.
function bucketOf(types: string[] = [], primaryType = ""): string {
  const all = new Set([...types, primaryType]);
  if (
    all.has("fast_food_restaurant") ||
    all.has("meal_takeaway") ||
    all.has("ice_cream_shop")
  )
    return "fast_food";
  if (all.has("cafe") || all.has("coffee_shop") || all.has("bakery"))
    return "cafe";
  return "restaurant";
}

// Google encodes cuisine in the type, e.g. "chinese_restaurant" → "chinese".
function cuisineFromType(
  primaryType = "",
  types: string[] = [],
): string | undefined {
  for (const t of [primaryType, ...types]) {
    const m = /^(.+)_restaurant$/.exec(t);
    if (m && m[1] !== "fast_food" && m[1] !== "meal") return m[1];
  }
  return undefined;
}
