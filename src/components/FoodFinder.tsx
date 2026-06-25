"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Restaurant } from "@/lib/overpass";
import {
  CUISINES,
  DIETS,
  FLAVORS,
  KINDS,
  PRICE_TIERS,
  estPriceTier,
  mapsDirUrl,
  mapsPlaceUrl,
  matchesCuisine,
  matchesDiet,
  matchesFlavor,
  prettyCuisine,
  prettyDistance,
  sampleN,
} from "@/lib/food";
import { openNow, type OpenState } from "@/lib/openNow";
import SwipeDeck from "@/components/SwipeDeck";

// 3D hero scene — client-only (WebGL), never server-rendered.
const Scene3D = dynamic(() => import("@/components/Scene3D"), { ssr: false });
// Map view — client-only. Google Maps when a public key is configured, else the
// free Leaflet/OSM map as fallback.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });
const GoogleMapView = dynamic(() => import("@/components/GoogleMapView"), {
  ssr: false,
});
const HAS_GMAPS = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

type HistoryItem = { name: string; at: number };
type Mode = "spin" | "versus" | "swipe" | "map";
type Status = "idle" | "locating" | "searching" | "ready" | "error";

const FETCH_RADIUS = 3000; // pull everything once, then filter by the slider client-side
const ACCURATE_ENOUGH = 30; // meters — stop refining the GPS fix once this good
const VERSUS_SIZE = 4;
const BLACKLIST_MS = 3 * 24 * 60 * 60 * 1000; // 「别再推」3 天后自动恢复

// Dev-only location presets for testing without being there. The whole panel is
// guarded by IS_DEV, so it (and these) are stripped from production builds.
const IS_DEV = process.env.NODE_ENV !== "production";
const DEV_PLACES = [
  { name: "TRX", lat: 3.1419, lon: 101.7188 },
  { name: "KLCC", lat: 3.1578, lon: 101.7117 },
  { name: "武吉免登", lat: 3.149, lon: 101.713 },
  { name: "Bangsar", lat: 3.1296, lon: 101.67 },
  { name: "Mid Valley", lat: 3.1177, lon: 101.6769 },
  { name: "Sunway", lat: 3.0726, lon: 101.6072 },
];

// neo-pop "press into the shadow" button base
const PRESS =
  "border-[3px] border-black transition active:translate-x-[3px] active:translate-y-[3px]";

export default function FoodFinder() {
  // location + data
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(
    null,
  );
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [simLabel, setSimLabel] = useState<string | null>(null);
  const [devLat, setDevLat] = useState("");
  const [devLon, setDevLon] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [source, setSource] = useState<"osm" | "google" | "google+osm">("osm");

  // filters (all applied client-side on the single fetched set)
  const [radius, setRadius] = useState(1500);
  const [kinds, setKinds] = useState<string[]>([
    "restaurant",
    "fast_food",
    "cafe",
  ]);
  const [flavor, setFlavor] = useState<string | null>(null);
  const [cuisineSel, setCuisineSel] = useState<string[]>([]);
  const [priceTier, setPriceTier] = useState<number | null>(null);
  const [dietSel, setDietSel] = useState<string[]>([]);
  const [openOnly, setOpenOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [avoidRecent, setAvoidRecent] = useState(true);

  // shared result
  const [mode, setMode] = useState<Mode>("spin");
  const [winner, setWinner] = useState<Restaurant | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [favorites, setFavorites] = useState<Restaurant[]>([]);
  const [blacklist, setBlacklist] = useState<
    { name: string; until: number }[]
  >([]);

  // spin mode
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState<string | null>(null);
  const [shakeOn, setShakeOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // versus mode
  const [vsQueue, setVsQueue] = useState<Restaurant[]>([]);
  const [vsWinners, setVsWinners] = useState<Restaurant[]>([]);
  const [vsTotal, setVsTotal] = useState(0);
  const [vsDone, setVsDone] = useState(0);

  // swipe mode
  const [swipeCards, setSwipeCards] = useState<Restaurant[]>([]);
  const [swipeRound, setSwipeRound] = useState(0);

  // geolocation handles (for cleanup)
  const geoWatch = useRef<number | null>(null);
  const geoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- candidate pool ----
  const withinRange = useMemo(
    () => restaurants.filter((r) => r.distance <= radius),
    [restaurants, radius],
  );
  const pool = useMemo(() => {
    let list = withinRange;
    if (kinds.length < KINDS.length)
      list = list.filter((r) => kinds.includes(r.kind));
    if (openOnly) list = list.filter((r) => openNow(r.openingHours) === "open");
    if (flavor) list = list.filter((r) => matchesFlavor(r, flavor));
    if (cuisineSel.length)
      list = list.filter((r) => matchesCuisine(r, cuisineSel));
    if (priceTier) list = list.filter((r) => estPriceTier(r) === priceTier);
    if (dietSel.length) list = list.filter((r) => matchesDiet(r, dietSel));
    if (blacklist.length) {
      const blocked = new Set(blacklist.map((b) => b.name));
      list = list.filter((r) => !blocked.has(r.name));
    }
    return list;
  }, [
    withinRange,
    kinds,
    openOnly,
    flavor,
    cuisineSel,
    priceTier,
    dietSel,
    blacklist,
  ]);

  // Random-pick pool — optionally drops the last few eaten so picks vary.
  function freshPool(): Restaurant[] {
    if (!avoidRecent) return pool;
    const recent = new Set(history.slice(0, 5).map((h) => h.name));
    const fresh = pool.filter((r) => !recent.has(r.name));
    return fresh.length >= 2 ? fresh : pool;
  }

  // ---- persistence + cleanup ----
  useEffect(() => {
    const load = (k: string) => {
      try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };
    const h = load("ff-history");
    const f = load("ff-favs");
    const rawB = load("ff-blacklist");
    const now = Date.now();
    // Migrate old string[] format, then drop entries past their 3-day expiry.
    const b = Array.isArray(rawB)
      ? rawB
          .map((x) =>
            typeof x === "string" ? { name: x, until: now + BLACKLIST_MS } : x,
          )
          .filter((x) => x && x.name && x.until > now)
      : null;
    // One-time hydration from localStorage after mount keeps SSR markup stable.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (h) setHistory(h);
    if (f) setFavorites(f);
    if (b) setBlacklist(b);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (geoTimer.current) clearTimeout(geoTimer.current);
      if (geoWatch.current !== null)
        navigator.geolocation.clearWatch(geoWatch.current);
    };
  }, []);

  function saveHistory(next: HistoryItem[]) {
    setHistory(next);
    try {
      localStorage.setItem("ff-history", JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }

  function saveFavs(next: Restaurant[]) {
    setFavorites(next);
    try {
      localStorage.setItem("ff-favs", JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }

  function saveBlacklist(next: { name: string; until: number }[]) {
    setBlacklist(next);
    try {
      localStorage.setItem("ff-blacklist", JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }

  const isFav = (r: Restaurant) => favorites.some((f) => f.name === r.name);
  function toggleFav(r: Restaurant) {
    saveFavs(
      isFav(r)
        ? favorites.filter((f) => f.name !== r.name)
        : [r, ...favorites].slice(0, 50),
    );
  }
  function neverAgain(name: string) {
    saveBlacklist(
      [
        { name, until: Date.now() + BLACKLIST_MS },
        ...blacklist.filter((b) => b.name !== name),
      ].slice(0, 300),
    );
    setWinner(null);
  }

  function recordWin(r: Restaurant) {
    setWinner(r);
    saveHistory([{ name: r.name, at: Date.now() }, ...history].slice(0, 12));
  }

  function resetResults() {
    setWinner(null);
    setDisplay(null);
    setVsQueue([]);
    setVsWinners([]);
    setVsTotal(0);
    setVsDone(0);
    setSpinning(false);
    if (timer.current) clearTimeout(timer.current);
  }

  // ---- precise location via watchPosition (keep the best fix) ----
  function locate() {
    if (!("geolocation" in navigator)) {
      setError("你的浏览器不支持定位功能");
      setStatus("error");
      return;
    }
    setStatus("locating");
    setError(null);

    let best: GeolocationCoordinates | null = null;
    let count = 0;
    let settled = false;

    const cleanup = () => {
      if (geoWatch.current !== null) {
        navigator.geolocation.clearWatch(geoWatch.current);
        geoWatch.current = null;
      }
      if (geoTimer.current) {
        clearTimeout(geoTimer.current);
        geoTimer.current = null;
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (best) {
        const c = { lat: best.latitude, lon: best.longitude };
        setAccuracy(Math.round(best.accuracy));
        setSimLabel(null);
        setCoords(c);
        search(c);
      } else {
        setError("无法获取你的位置，请重试");
        setStatus("error");
      }
    };

    geoWatch.current = navigator.geolocation.watchPosition(
      (pos) => {
        count += 1;
        if (!best || pos.coords.accuracy < best.accuracy) best = pos.coords;
        if (best.accuracy <= ACCURATE_ENOUGH || count >= 6) finish();
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        setError(
          err.code === err.PERMISSION_DENIED
            ? "定位被拒绝，请在浏览器里允许位置权限后重试"
            : "无法获取你的位置，请重试",
        );
        setStatus("error");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );

    // fall back to the best fix collected so far after a few seconds
    geoTimer.current = setTimeout(finish, 9000);
  }

  async function search(c: { lat: number; lon: number }) {
    setStatus("searching");
    setError(null);
    resetResults();
    try {
      const url = `/api/restaurants?lat=${c.lat}&lon=${c.lon}&radius=${FETCH_RADIUS}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "搜索失败");
      setRestaurants(data.restaurants as Restaurant[]);
      if (data.source === "google" || data.source === "google+osm")
        setSource(data.source);
      else setSource("osm");
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败，请稍后再试");
      setStatus("error");
    }
  }

  // Dev-only: jump to a preset/custom location without real GPS.
  function simulateLocation(lat: number, lon: number, label: string) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    setSimLabel(label);
    setAccuracy(null);
    setCoords({ lat, lon });
    search({ lat, lon });
  }

  function toggleKind(v: string) {
    setKinds((prev) =>
      prev.includes(v)
        ? prev.length > 1
          ? prev.filter((k) => k !== v)
          : prev
        : [...prev, v],
    );
  }

  function toggleCuisine(k: string) {
    setCuisineSel((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  }

  function toggleDiet(k: string) {
    setDietSel((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    );
  }

  function startSwipe() {
    setWinner(null);
    setSwipeCards(sampleN(freshPool(), 24));
    setSwipeRound((n) => n + 1);
  }

  // ---- spin (slot machine) ----
  function spin() {
    if (spinning || pool.length === 0) return;
    setSpinning(true);
    setWinner(null);

    const choices = freshPool();
    const pick = choices[Math.floor(Math.random() * choices.length)];

    let elapsed = 0;
    let delay = 60;
    const step = () => {
      const rnd = pool[Math.floor(Math.random() * pool.length)];
      setDisplay(rnd.name);
      elapsed += delay;
      delay *= 1.12;
      if (elapsed < 2500) {
        timer.current = setTimeout(step, delay);
      } else {
        setDisplay(pick.name);
        setSpinning(false);
        recordWin(pick);
      }
    };
    step();
  }

  // keep the shake listener pointed at the latest spin closure
  const spinRef = useRef(spin);
  useEffect(() => {
    spinRef.current = spin;
  });

  async function enableShake() {
    type DMEPermission = {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    const dme = window.DeviceMotionEvent as unknown as DMEPermission | undefined;
    if (dme && typeof dme.requestPermission === "function") {
      try {
        const res = await dme.requestPermission();
        if (res !== "granted") {
          setError("未授予动作权限，无法使用摇一摇");
          return;
        }
      } catch {
        return;
      }
    }
    setShakeOn(true);
  }

  useEffect(() => {
    if (!shakeOn) return;
    let last = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      const now = Date.now();
      if (mag > 28 && now - last > 1500) {
        last = now;
        spinRef.current();
      }
    };
    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [shakeOn]);

  // ---- versus (elimination bracket) ----
  function startVersus() {
    const fp = freshPool();
    const contestants = sampleN(fp, Math.min(VERSUS_SIZE, fp.length));
    if (contestants.length < 2) return;
    setWinner(null);
    setVsTotal(contestants.length - 1);
    setVsDone(0);
    setVsWinners([]);
    setVsQueue(contestants);
  }

  function pickVersus(chosen: Restaurant) {
    let nextQueue = vsQueue.slice(2);
    let nextWinners = [...vsWinners, chosen];
    const done = vsDone + 1;

    if (nextQueue.length === 1) {
      nextWinners = [...nextWinners, nextQueue[0]];
      nextQueue = [];
    }
    if (nextQueue.length === 0) {
      if (nextWinners.length === 1) {
        setVsQueue([]);
        setVsDone(done);
        recordWin(nextWinners[0]);
        return;
      }
      nextQueue = nextWinners;
      nextWinners = [];
    }
    setVsQueue(nextQueue);
    setVsWinners(nextWinners);
    setVsDone(done);
  }

  // ---- view ----
  const filtersActive =
    kinds.length < KINDS.length ||
    !!flavor ||
    cuisineSel.length > 0 ||
    priceTier !== null ||
    dietSel.length > 0 ||
    openOnly ||
    radius !== 1500;
  const located = coords !== null;
  const busy = status === "locating" || status === "searching";
  const supportsMotion =
    typeof window !== "undefined" && "DeviceMotionEvent" in window;

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#fff4e0] text-[#1a1410]">
      <Stickers />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pt-[max(1.75rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-5">
        {IS_DEV && (
          <div className="mb-4 rounded-2xl border-2 border-dashed border-black bg-white p-3 text-xs shadow-[3px_3px_0_0_#000]">
            <div className="mb-2 font-black">
              🧪 测试定位{" "}
              <span className="font-medium text-black/40">仅开发模式可见</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DEV_PLACES.map((p) => (
                <button
                  key={p.name}
                  onClick={() => simulateLocation(p.lat, p.lon, p.name)}
                  className={`rounded-full border-2 border-black px-2.5 py-1 font-bold transition active:translate-x-[1px] active:translate-y-[1px] ${
                    simLabel === p.name
                      ? "bg-[#ff5436] text-white"
                      : "bg-white text-black"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <input
                inputMode="decimal"
                value={devLat}
                onChange={(e) => setDevLat(e.target.value)}
                placeholder="纬度 lat"
                className="w-24 rounded-md border-2 border-black bg-white px-2 py-1 font-medium placeholder:text-black/30"
              />
              <input
                inputMode="decimal"
                value={devLon}
                onChange={(e) => setDevLon(e.target.value)}
                placeholder="经度 lon"
                className="w-24 rounded-md border-2 border-black bg-white px-2 py-1 font-medium placeholder:text-black/30"
              />
              <button
                onClick={() =>
                  simulateLocation(Number(devLat), Number(devLon), "自定义")
                }
                className="rounded-md border-2 border-black bg-black px-3 py-1 font-bold text-white active:translate-x-[1px] active:translate-y-[1px]"
              >
                定位
              </button>
            </div>
          </div>
        )}

        <header className="text-center">
          <div className="mb-3 inline-block -rotate-2 rounded-full border-[3px] border-black bg-[#ffc83d] px-3 py-1 text-xs font-black shadow-[3px_3px_0_0_#000]">
            附近 · 随机 · 不纠结
          </div>
          <h1 className="text-5xl font-black tracking-tight text-[#ff5436] [text-shadow:3px_3px_0_#000]">
            吃啥呢？<span className="ff-wiggle inline-block">🍜</span>
          </h1>
          <p className="mt-3 text-sm font-bold text-black/60">
            选择困难症？让命运帮你决定今天吃什么。
          </p>
        </header>

        {!located ? (
          /* Step 1 — location */
          <div className="mt-10 flex flex-1 flex-col items-center justify-center gap-6 text-center sm:mt-14">
            <div className="ff-bob text-8xl drop-shadow-[4px_4px_0_rgba(0,0,0,0.25)]">
              📍
            </div>
            <p className="max-w-xs text-sm font-bold text-black/60">
              先让我精准定位你的位置，才能找到真正在你附近的美食。位置只在你的设备上使用，不会保存。
            </p>
            <button
              onClick={locate}
              disabled={busy}
              className={`${PRESS} ${busy ? "" : "ff-bob"} rounded-full bg-[#ff5436] px-9 py-4 text-lg font-black text-white shadow-[5px_5px_0_0_#000] active:shadow-[1px_1px_0_0_#000] disabled:opacity-60`}
            >
              {status === "locating" ? "正在精准定位…" : "📍 获取我的位置"}
            </button>
            {error && <p className="text-sm font-bold text-[#ff5436]">{error}</p>}
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-5">
            {/* location chip */}
            <div className="flex items-center justify-center gap-2 text-xs font-bold">
              <span className="inline-flex items-center gap-1 rounded-full border-2 border-black bg-white px-3 py-1 shadow-[2px_2px_0_0_#000]">
                📍 已定位
                {simLabel ? (
                  <span className="text-[#ff5436]">· 模拟：{simLabel}</span>
                ) : (
                  accuracy != null && (
                    <span className="text-black/40">· 精度 ±{accuracy}m</span>
                  )
                )}
              </span>
              <button
                onClick={locate}
                disabled={busy}
                className="rounded-full border-2 border-black bg-white px-3 py-1 font-bold shadow-[2px_2px_0_0_#000] transition active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:opacity-60"
              >
                {status === "locating" ? "定位中…" : "重新定位"}
              </button>
            </div>

            {/* Filters — collapsed by default (decide-first) */}
            <section className="rounded-3xl border-[3px] border-black bg-white p-3 shadow-[5px_5px_0_0_#000]">
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="flex w-full items-center justify-between px-1 py-1 text-left"
              >
                <span className="text-sm font-black">
                  🔧 筛选{filtersActive ? " · 已调" : ""}
                </span>
                <span className="text-xs font-bold text-black/50">
                  {status === "ready"
                    ? restaurants.length === 0
                      ? "附近没找到"
                      : pool.length === 0
                        ? "无结果"
                        : `范围内 ${pool.length} 家`
                    : ""}{" "}
                  {showFilters ? "▲" : "▼"}
                </span>
              </button>

              {showFilters && (
                <div className="mt-3">
                  <div className="mb-4">
                    <div className="mb-1.5 flex items-center justify-between text-sm font-black">
                      <span>搜索范围</span>
                  <span className="rounded-full border-2 border-black bg-[#ffc83d] px-2 py-0.5 text-xs">
                    {prettyDistance(radius)}
                  </span>
                </div>
                <input
                  type="range"
                  min={300}
                  max={3000}
                  step={100}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer accent-[#ff5436]"
                />
              </div>

              <FilterGroup label="类型">
                <div className="flex flex-wrap gap-2">
                  {KINDS.map((k) => (
                    <Chip
                      key={k.value}
                      on={kinds.includes(k.value)}
                      onClick={() => toggleKind(k.value)}
                    >
                      {k.label}
                    </Chip>
                  ))}
                </div>
              </FilterGroup>

              <FilterGroup label="口味">
                <div className="grid grid-cols-2 gap-2">
                  {FLAVORS.map((f) => {
                    const on = flavor === f.key;
                    const tint = f.key === "heavy" ? "#ff5436" : "#19c3b1";
                    return (
                      <button
                        key={f.key}
                        onClick={() => setFlavor(on ? null : f.key)}
                        className="rounded-2xl border-[3px] border-black px-3 py-2.5 text-left shadow-[3px_3px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#000]"
                        style={{ background: on ? tint : "#fff" }}
                      >
                        <div
                          className={`text-sm font-black ${on ? "text-white" : "text-black"}`}
                        >
                          {f.emoji} {f.label}
                        </div>
                        <div
                          className={`text-[11px] font-bold ${on ? "text-white/85" : "text-black/40"}`}
                        >
                          {f.desc}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </FilterGroup>

              <FilterGroup label="人均（估算）">
                <div className="flex flex-wrap gap-2">
                  {PRICE_TIERS.map((p) => (
                    <Chip
                      key={p.key}
                      on={priceTier === p.tier}
                      onClick={() =>
                        setPriceTier(priceTier === p.tier ? null : p.tier)
                      }
                    >
                      {p.label}
                    </Chip>
                  ))}
                </div>
              </FilterGroup>

              <FilterGroup label="想吃啥">
                <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  {CUISINES.map((cu) => (
                    <button
                      key={cu.key}
                      onClick={() => toggleCuisine(cu.key)}
                      className={`shrink-0 rounded-full border-2 border-black px-3 py-1.5 text-sm font-black shadow-[2px_2px_0_0_#000] transition active:translate-x-[1px] active:translate-y-[1px] active:shadow-none ${
                        cuisineSel.includes(cu.key)
                          ? "bg-[#ff7eb3] text-white"
                          : "bg-white text-black/45"
                      }`}
                    >
                      {cu.label}
                    </button>
                  ))}
                </div>
              </FilterGroup>

              <FilterGroup label="饮食">
                <div className="flex flex-wrap gap-2">
                  {DIETS.map((d) => (
                    <Chip
                      key={d.key}
                      on={dietSel.includes(d.key)}
                      onClick={() => toggleDiet(d.key)}
                    >
                      {d.label}
                    </Chip>
                  ))}
                </div>
                <p className="mt-1 text-[11px] font-medium text-black/35">
                  仅显示有标注的（数据可能不全）
                </p>
              </FilterGroup>

              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={openOnly}
                  onChange={(e) => setOpenOnly(e.target.checked)}
                  className="h-4 w-4 accent-[#ff5436]"
                />
                只看现在营业中
                <span className="text-xs font-medium text-black/40">（参考）</span>
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={avoidRecent}
                  onChange={(e) => setAvoidRecent(e.target.checked)}
                  className="h-4 w-4 accent-[#ff5436]"
                />
                避免最近吃过的
              </label>
                </div>
              )}
              {error && (
                <p className="mt-3 text-center text-xs font-bold text-[#ff5436]">
                  {error}
                </p>
              )}
            </section>

            {/* Mode switch */}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["spin", "🎰 转盘"],
                  ["versus", "⚔️ PK"],
                  ["swipe", "🃏 滑卡"],
                  ["map", "🗺️ 地图"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => {
                    if (mode !== m) {
                      setMode(m);
                      resetResults();
                      if (m === "swipe") startSwipe();
                    }
                  }}
                  className={`rounded-full border-[3px] border-black py-2 text-sm font-black transition active:translate-x-[2px] active:translate-y-[2px] ${
                    mode === m
                      ? "bg-[#3d7bff] text-white shadow-[3px_3px_0_0_#000] active:shadow-[1px_1px_0_0_#000]"
                      : "bg-white text-black/50 shadow-[3px_3px_0_0_#000] active:shadow-[1px_1px_0_0_#000]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Spin mode */}
            {mode === "spin" && (
              <section className="flex flex-col items-center gap-4">
                <div className="relative h-64 w-full">
                  <Scene3D spinning={spinning} />
                </div>
                <div className="relative h-16 w-full overflow-hidden rounded-2xl border-[3px] border-black bg-white shadow-[4px_4px_0_0_#000]">
                  <div
                    className={`flex h-full items-center justify-center break-words px-4 text-center text-xl font-black ${
                      spinning ? "ff-wiggle text-[#ff5436]" : "text-black"
                    }`}
                  >
                    {display ?? (pool.length ? "准备好了吗？" : "调整筛选试试")}
                  </div>
                  {spinning && (
                    <div className="ff-shimmer pointer-events-none absolute inset-0" />
                  )}
                </div>

                <button
                  onClick={spin}
                  disabled={spinning || pool.length === 0}
                  className={`${PRESS} ${spinning || pool.length === 0 ? "" : "ff-bob"} rounded-full bg-[#ff5436] px-10 py-4 text-2xl font-black text-white shadow-[5px_5px_0_0_#000] active:shadow-[1px_1px_0_0_#000] disabled:opacity-50`}
                >
                  {spinning ? "转动中…" : "🎲 帮我决定！"}
                </button>

                {supportsMotion &&
                  (shakeOn ? (
                    <p className="text-xs font-bold text-black/40">
                      📳 摇一摇手机换一家
                    </p>
                  ) : (
                    <button
                      onClick={enableShake}
                      className="text-xs font-bold text-black/40 underline"
                    >
                      📳 开启摇一摇随机
                    </button>
                  ))}
              </section>
            )}

            {/* Versus mode */}
            {mode === "versus" && (
              <section className="flex flex-col items-center gap-3">
                {vsQueue.length >= 2 ? (
                  <>
                    <p className="text-sm font-black">
                      第 {Math.min(vsDone + 1, vsTotal)} / {vsTotal} 场 ·
                      选你更想吃的
                    </p>
                    <VersusCard r={vsQueue[0]} onPick={pickVersus} />
                    <div className="-my-1 -rotate-6 rounded-full border-[3px] border-black bg-[#ffc83d] px-3 py-0.5 text-sm font-black shadow-[2px_2px_0_0_#000]">
                      VS
                    </div>
                    <VersusCard r={vsQueue[1]} onPick={pickVersus} />
                    <button
                      onClick={startVersus}
                      className="mt-1 text-xs font-bold text-black/40 underline"
                    >
                      重新抽一组
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={startVersus}
                      disabled={pool.length < 2}
                      className={`${PRESS} ${pool.length < 2 ? "" : "ff-bob"} rounded-full bg-[#ff5436] px-10 py-4 text-2xl font-black text-white shadow-[5px_5px_0_0_#000] active:shadow-[1px_1px_0_0_#000] disabled:opacity-50`}
                    >
                      ⚔️ 开始 PK
                    </button>
                    <p className="text-xs font-bold text-black/40">
                      从附近随机抽{" "}
                      {Math.min(VERSUS_SIZE, Math.max(pool.length, 0))} 家两两对决
                    </p>
                  </>
                )}
              </section>
            )}

            {/* Swipe mode */}
            {mode === "swipe" && !winner && (
              <section className="flex flex-col items-center">
                {pool.length === 0 ? (
                  <p className="text-sm font-bold text-black/50">
                    调整筛选后再来滑 🃏
                  </p>
                ) : (
                  <SwipeDeck
                    key={swipeRound}
                    cards={swipeCards}
                    onDecide={recordWin}
                    onReshuffle={startSwipe}
                  />
                )}
              </section>
            )}

            {/* Map mode */}
            {mode === "map" && coords && (
              <section>
                {pool.length === 0 ? (
                  <p className="text-center text-sm font-bold text-black/50">
                    调整筛选后再看地图 🗺️
                  </p>
                ) : HAS_GMAPS ? (
                  <GoogleMapView
                    coords={coords}
                    restaurants={pool}
                    onPick={recordWin}
                  />
                ) : (
                  <MapView
                    coords={coords}
                    restaurants={pool}
                    onPick={recordWin}
                  />
                )}
              </section>
            )}

            {/* Winner */}
            {winner && !spinning && (
              <section className="ff-bounce-in relative overflow-hidden rounded-3xl border-[3px] border-black bg-white shadow-[6px_6px_0_0_#000]">
                <Confetti key={winner.name} />
                <div className="relative border-b-[3px] border-black bg-[#ff5436] px-5 py-2 text-sm font-black text-white">
                  🎉 就决定是你了！
                </div>
                <div className="relative p-5">
                  <h2 className="break-words text-3xl font-black">
                    {winner.name}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm font-bold text-black/70">
                    <span className="rounded-full border-2 border-black bg-[#ffc83d] px-2 py-0.5">
                      {KINDS.find((k) => k.value === winner.kind)?.short ??
                        winner.kind}
                    </span>
                    {prettyCuisine(winner.cuisine) && (
                      <span className="rounded-full border-2 border-black bg-[#ff7eb3] px-2 py-0.5 text-white">
                        {prettyCuisine(winner.cuisine)}
                      </span>
                    )}
                    <span>📍 {prettyDistance(winner.distance)}</span>
                    <OpenBadge state={openNow(winner.openingHours)} />
                  </div>
                  {winner.openingHours && (
                    <p className="mt-2 break-words text-xs font-medium text-black/40">
                      营业时间：{winner.openingHours}
                    </p>
                  )}
                  <div className="mt-4 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <a
                        href={mapsDirUrl(winner)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 rounded-2xl border-[3px] border-black bg-[#3d7bff] py-2.5 text-center text-sm font-black text-white shadow-[3px_3px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                      >
                        🧭 导航前往
                      </a>
                      <a
                        href={mapsPlaceUrl(winner)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 rounded-2xl border-[3px] border-black bg-[#ffc83d] py-2.5 text-center text-sm font-black text-black shadow-[3px_3px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                      >
                        📋 评分·菜单
                      </a>
                    </div>
                    <button
                      onClick={() => {
                        if (mode === "spin") spin();
                        else if (mode === "versus") startVersus();
                        else if (mode === "swipe") startSwipe();
                        else setWinner(null);
                      }}
                      className="rounded-2xl border-[3px] border-black bg-white py-2.5 text-center text-sm font-black text-black shadow-[3px_3px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                    >
                      🔁 再来一次
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleFav(winner)}
                        className={`flex-1 rounded-2xl border-[3px] border-black py-2 text-center text-sm font-black text-black shadow-[3px_3px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                          isFav(winner) ? "bg-[#ffc83d]" : "bg-white"
                        }`}
                      >
                        {isFav(winner) ? "★ 已收藏" : "☆ 收藏"}
                      </button>
                      <button
                        onClick={() => neverAgain(winner.name)}
                        className="flex-1 rounded-2xl border-[3px] border-black bg-white py-2 text-center text-sm font-black text-black shadow-[3px_3px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                      >
                        🚫 别再推
                      </button>
                    </div>
                  </div>
                  {winner.website && (
                    <a
                      href={winner.website}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 block truncate text-center text-xs font-bold text-black/40 underline"
                    >
                      {winner.website}
                    </a>
                  )}
                  {winner.phone && (
                    <a
                      href={`tel:${winner.phone}`}
                      className="mt-2 block text-center text-xs font-bold text-black/40 underline"
                    >
                      ☎️ {winner.phone}
                    </a>
                  )}
                </div>
              </section>
            )}

            {/* Favorites */}
            {favorites.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-black">⭐ 我的收藏</h3>
                <ul className="flex flex-col gap-2">
                  {favorites.map((f) => (
                    <li
                      key={f.name}
                      className="flex items-center gap-2 rounded-2xl border-2 border-black bg-white px-3 py-1.5 shadow-[2px_2px_0_0_#000]"
                    >
                      <a
                        href={mapsDirUrl(f)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 truncate text-sm font-bold"
                      >
                        {f.name}
                      </a>
                      <a
                        href={mapsPlaceUrl(f)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold text-black/40 underline"
                      >
                        详情
                      </a>
                      <button
                        onClick={() =>
                          saveFavs(favorites.filter((x) => x.name !== f.name))
                        }
                        className="px-1 text-base font-black text-black/40"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Blacklist restore */}
            {blacklist.length > 0 && (
              <button
                onClick={() => saveBlacklist([])}
                className="text-center text-xs font-bold text-black/40 underline"
              >
                🚫 已排除 {blacklist.length} 家（3 天后自动恢复）· 点此立即恢复
              </button>
            )}

            {/* History */}
            {history.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-black">最近选过</h3>
                  <button
                    onClick={() => saveHistory([])}
                    className="text-xs font-bold text-black/40 underline"
                  >
                    清空
                  </button>
                </div>
                <ul className="flex flex-wrap gap-2">
                  {history.map((h, i) => (
                    <li
                      key={`${h.name}-${i}`}
                      className="max-w-full truncate rounded-full border-2 border-black bg-white px-3 py-1 text-xs font-bold"
                    >
                      {h.name}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        <footer className="mt-auto pt-8 text-center text-xs font-bold text-black/30">
          数据来自{" "}
          {source === "google"
            ? "Google Places"
            : source === "google+osm"
              ? "Google Places + OpenStreetMap"
              : "OpenStreetMap"}{" "}
          · 仅供参考
        </footer>
      </div>
    </main>
  );
}

// Decorative food stickers scattered in the margins (behind the opaque content).
function Stickers() {
  const items = [
    { e: "🍔", c: "left-1 top-28 text-5xl -rotate-12" },
    { e: "🍕", c: "right-1 top-44 text-4xl rotate-12", d: "0.5s" },
    { e: "🧋", c: "left-2 bottom-56 text-4xl rotate-6", d: "0.8s" },
    { e: "🌮", c: "right-2 bottom-40 text-4xl -rotate-6", d: "0.3s" },
    { e: "🍣", c: "left-1/2 top-8 text-3xl -rotate-6", d: "1s" },
  ];
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-70">
      {items.map((it, i) => (
        <span
          key={i}
          className={`ff-bob absolute ${it.c}`}
          style={{ animationDelay: it.d }}
        >
          {it.e}
        </span>
      ))}
    </div>
  );
}

// Dependency-free confetti burst, re-mounted per winner (via key). Positions use
// a pure sin-based pseudo-random (not Math.random) to stay render-safe.
function Confetti() {
  const colors = ["#ff5436", "#ffc83d", "#ff7eb3", "#19c3b1", "#3d7bff"];
  const rand = (n: number) => {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const pieces = Array.from({ length: 34 }, (_, i) => ({
    left: rand(i + 1) * 100,
    tx: (rand(i + 7) - 0.5) * 220,
    delay: rand(i + 13) * 0.15,
    dur: 0.7 + rand(i + 19) * 0.6,
    color: colors[i % colors.length],
    rounded: i % 2 === 0,
  }));
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0">
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`ff-confetti absolute top-0 h-2.5 w-2.5 ${p.rounded ? "rounded-full" : "rounded-[2px]"}`}
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            ["--tx" as string]: `${p.tx}px`,
          }}
        />
      ))}
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-xs font-black uppercase tracking-wide text-black/40">
        {label}
      </div>
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border-2 border-black px-3 py-1.5 text-sm font-black shadow-[2px_2px_0_0_#000] transition active:translate-x-[1px] active:translate-y-[1px] active:shadow-none ${
        on ? "bg-[#ffc83d] text-black" : "bg-white text-black/45"
      }`}
    >
      {children}
    </button>
  );
}

function VersusCard({
  r,
  onPick,
}: {
  r: Restaurant;
  onPick: (r: Restaurant) => void;
}) {
  const cuisine = prettyCuisine(r.cuisine);
  return (
    <button
      onClick={() => onPick(r)}
      className="ff-rise w-full rounded-2xl border-[3px] border-black bg-white p-4 text-left shadow-[5px_5px_0_0_#000] transition hover:-translate-y-1 hover:shadow-[7px_7px_0_0_#000] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
    >
      <div className="break-words text-lg font-black">{r.name}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-black/70">
        <span className="rounded-full border-2 border-black bg-[#ffc83d] px-2 py-0.5">
          {KINDS.find((k) => k.value === r.kind)?.short ?? r.kind}
        </span>
        {cuisine && (
          <span className="rounded-full border-2 border-black bg-[#ff7eb3] px-2 py-0.5 text-white">
            {cuisine}
          </span>
        )}
        <span>📍 {prettyDistance(r.distance)}</span>
      </div>
    </button>
  );
}

function OpenBadge({ state }: { state: OpenState }) {
  if (state === "open")
    return (
      <span className="rounded-full border-2 border-black bg-[#19c3b1] px-2 py-0.5 text-white">
        营业中
      </span>
    );
  if (state === "closed")
    return (
      <span className="rounded-full border-2 border-black bg-white px-2 py-0.5 text-black/50">
        已打烊
      </span>
    );
  return null;
}
