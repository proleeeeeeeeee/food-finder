"use client";

import { useState } from "react";
import {
  GoogleMap,
  MarkerF,
  InfoWindowF,
  useJsApiLoader,
} from "@react-google-maps/api";
import type { Restaurant } from "@/lib/overpass";
import { KINDS, prettyCuisine, prettyDistance } from "@/lib/food";

// Browser-exposed key (referrer-restricted in Google Cloud). NEXT_PUBLIC_* is
// intentionally inlined into the client bundle.
const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";

const WRAP =
  "h-[340px] w-full overflow-hidden rounded-3xl border-[3px] border-black shadow-[5px_5px_0_0_#000]";

export default function GoogleMapView({
  coords,
  restaurants,
  onPick,
}: {
  coords: { lat: number; lon: number };
  restaurants: Restaurant[];
  onPick: (r: Restaurant) => void;
}) {
  const { isLoaded } = useJsApiLoader({ id: "gmaps", googleMapsApiKey: KEY });
  const [active, setActive] = useState<Restaurant | null>(null);
  const shown = restaurants.slice(0, 60); // nearest 60 — keeps it snappy

  if (!isLoaded) {
    return (
      <div
        className={`${WRAP} flex items-center justify-center bg-white text-sm font-black text-black/50`}
      >
        地图加载中…
      </div>
    );
  }

  return (
    <div className={WRAP}>
      <GoogleMap
        center={{ lat: coords.lat, lng: coords.lon }}
        zoom={15}
        mapContainerStyle={{ width: "100%", height: "100%" }}
        options={{
          clickableIcons: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        }}
      >
        <MarkerF position={{ lat: coords.lat, lng: coords.lon }} title="你在这" />
        {shown.map((r) => (
          <MarkerF
            key={r.id}
            position={{ lat: r.lat, lng: r.lon }}
            onClick={() => setActive(r)}
          />
        ))}
        {active && (
          <InfoWindowF
            position={{ lat: active.lat, lng: active.lon }}
            onCloseClick={() => setActive(null)}
          >
            <div style={{ minWidth: 150 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{active.name}</div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                {KINDS.find((k) => k.value === active.kind)?.short ??
                  active.kind}
                {prettyCuisine(active.cuisine)
                  ? ` · ${prettyCuisine(active.cuisine)}`
                  : ""}
                {` · ${prettyDistance(active.distance)}`}
              </div>
              <button
                onClick={() => onPick(active)}
                style={{
                  marginTop: 8,
                  width: "100%",
                  border: "2px solid #000",
                  borderRadius: 10,
                  background: "#ff5436",
                  color: "#fff",
                  fontWeight: 800,
                  padding: "6px 0",
                  cursor: "pointer",
                }}
              >
                🎲 就吃这家
              </button>
            </div>
          </InfoWindowF>
        )}
      </GoogleMap>
    </div>
  );
}
