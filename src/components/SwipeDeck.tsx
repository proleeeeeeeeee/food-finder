"use client";

import { useRef, useState } from "react";
import type { Restaurant } from "@/lib/overpass";
import { KINDS, prettyCuisine, prettyDistance } from "@/lib/food";

// Tinder-style deck: swipe right = 想吃 (like), left = 跳过. At the end, pick
// randomly from the liked ones. Pure pointer events + transforms (no library).
export default function SwipeDeck({
  cards,
  onDecide,
  onReshuffle,
}: {
  cards: Restaurant[];
  onDecide: (r: Restaurant) => void;
  onReshuffle: () => void;
}) {
  const [i, setI] = useState(0);
  const [likes, setLikes] = useState<Restaurant[]>([]);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const draggingRef = useRef(false);

  const top = cards[i];
  const next = cards[i + 1];
  const done = i >= cards.length;

  function decide(like: boolean) {
    const card = cards[i];
    if (card && like) setLikes((p) => [...p, card]);
    setDx(0);
    setI((n) => n + 1);
  }

  function onPointerDown(e: React.PointerEvent) {
    draggingRef.current = true;
    setDragging(true);
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    setDx(e.clientX - startX.current);
  }
  function onPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (dx > 90) decide(true);
    else if (dx < -90) decide(false);
    else setDx(0);
  }

  if (done) {
    return (
      <div className="ff-pop w-full rounded-3xl border-[3px] border-black bg-white p-6 text-center shadow-[6px_6px_0_0_#000]">
        <div className="text-5xl">{likes.length ? "😋" : "🤔"}</div>
        <p className="mt-2 text-lg font-black">
          {likes.length ? `你想吃的有 ${likes.length} 家` : "一家都没看上？"}
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {likes.length > 0 && (
            <button
              onClick={() =>
                onDecide(likes[Math.floor(Math.random() * likes.length)])
              }
              className="rounded-2xl border-[3px] border-black bg-[#ff5436] py-3 text-base font-black text-white shadow-[4px_4px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
            >
              🎲 从喜欢的里帮我选！
            </button>
          )}
          <button
            onClick={onReshuffle}
            className="rounded-2xl border-[3px] border-black bg-white py-3 text-base font-black shadow-[4px_4px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
          >
            🔄 再刷一组
          </button>
        </div>
      </div>
    );
  }

  const rot = dx / 18;
  const likeOpacity = Math.min(Math.max(dx / 90, 0), 1);
  const nopeOpacity = Math.min(Math.max(-dx / 90, 0), 1);

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <p className="text-sm font-black text-black/60">
        {i + 1} / {cards.length} · ❤️ {likes.length}
      </p>
      <div className="relative h-56 w-full max-w-xs select-none">
        {next && (
          <div className="absolute inset-0 translate-y-2 scale-95 rounded-3xl border-[3px] border-black bg-white shadow-[5px_5px_0_0_#000]" />
        )}
        {top && (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              transform: `translateX(${dx}px) rotate(${rot}deg)`,
              transition: dragging ? "none" : "transform 0.25s",
              touchAction: "none",
            }}
            className="absolute inset-0 flex cursor-grab flex-col justify-between rounded-3xl border-[3px] border-black bg-white p-5 shadow-[6px_6px_0_0_#000] active:cursor-grabbing"
          >
            <div className="flex justify-between">
              <span
                style={{ opacity: likeOpacity }}
                className="-rotate-12 rounded-lg border-[3px] border-[#19c3b1] px-2 py-0.5 text-lg font-black text-[#19c3b1]"
              >
                想吃!
              </span>
              <span
                style={{ opacity: nopeOpacity }}
                className="rotate-12 rounded-lg border-[3px] border-[#ff5436] px-2 py-0.5 text-lg font-black text-[#ff5436]"
              >
                跳过
              </span>
            </div>
            <div>
              <div className="break-words text-2xl font-black">{top.name}</div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-bold text-black/70">
                <span className="rounded-full border-2 border-black bg-[#ffc83d] px-2 py-0.5">
                  {KINDS.find((k) => k.value === top.kind)?.short ?? top.kind}
                </span>
                {prettyCuisine(top.cuisine) && (
                  <span className="rounded-full border-2 border-black bg-[#ff7eb3] px-2 py-0.5 text-white">
                    {prettyCuisine(top.cuisine)}
                  </span>
                )}
                <span>📍 {prettyDistance(top.distance)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-5">
        <button
          onClick={() => decide(false)}
          className="flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-black bg-white text-2xl shadow-[3px_3px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          👎
        </button>
        <button
          onClick={() => decide(true)}
          className="flex h-16 w-16 items-center justify-center rounded-full border-[3px] border-black bg-[#ff5436] text-3xl shadow-[4px_4px_0_0_#000] transition active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
        >
          ❤️
        </button>
      </div>
      <p className="text-xs font-bold text-black/40">左右滑动，或点下面按钮</p>
    </div>
  );
}
