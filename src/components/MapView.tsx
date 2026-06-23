"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Restaurant } from "@/lib/overpass";
import { KINDS, prettyCuisine, prettyDistance } from "@/lib/food";

// Emoji div-icons — avoids Leaflet's broken default-marker-image issue entirely.
const userIcon = L.divIcon({
  html: '<div style="font-size:26px;filter:drop-shadow(1px 1px 0 #000)">📍</div>',
  className: "",
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});
const foodIcon = L.divIcon({
  html: '<div style="font-size:22px;filter:drop-shadow(1px 1px 0 rgba(0,0,0,.45))">🍴</div>',
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export default function MapView({
  coords,
  restaurants,
  onPick,
}: {
  coords: { lat: number; lon: number };
  restaurants: Restaurant[];
  onPick: (r: Restaurant) => void;
}) {
  const shown = restaurants.slice(0, 60); // nearest 60 — keeps the map snappy
  return (
    <div className="h-[340px] w-full overflow-hidden rounded-3xl border-[3px] border-black shadow-[5px_5px_0_0_#000]">
      <MapContainer
        center={[coords.lat, coords.lon]}
        zoom={15}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[coords.lat, coords.lon]} icon={userIcon} />
        {shown.map((r) => (
          <Marker key={r.id} position={[r.lat, r.lon]} icon={foodIcon}>
            <Popup>
              <div style={{ minWidth: 150 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                  {KINDS.find((k) => k.value === r.kind)?.short ?? r.kind}
                  {prettyCuisine(r.cuisine) ? ` · ${prettyCuisine(r.cuisine)}` : ""}
                  {` · ${prettyDistance(r.distance)}`}
                </div>
                <button
                  onClick={() => onPick(r)}
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
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
