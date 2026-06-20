// Lightweight, dependency-free best-effort parser for OSM `opening_hours`.
// Handles the common shapes (24/7, day ranges/lists, multiple time ranges,
// "off"); anything it can't confidently parse returns "unknown" so the UI can
// be honest rather than guess.

export type OpenState = "open" | "closed" | "unknown";

const DAY_IDX: Record<string, number> = {
  Su: 0,
  Mo: 1,
  Tu: 2,
  We: 3,
  Th: 4,
  Fr: 5,
  Sa: 6,
};

type Rule = { days: Set<number>; off: boolean; intervals: [number, number][] };

function parseDays(spec: string): Set<number> | null {
  const clean = spec.replace(/\s/g, "");
  if (!clean) return new Set([0, 1, 2, 3, 4, 5, 6]); // no day prefix => every day
  const set = new Set<number>();
  for (const part of clean.split(",")) {
    if (!part) continue;
    const range = part.split("-");
    if (range.length === 1) {
      const d = DAY_IDX[range[0]];
      if (d === undefined) return null;
      set.add(d);
    } else if (range.length === 2) {
      const a = DAY_IDX[range[0]];
      const b = DAY_IDX[range[1]];
      if (a === undefined || b === undefined) return null;
      for (let i = a, guard = 0; guard < 8; guard++) {
        set.add(i);
        if (i === b) break;
        i = (i + 1) % 7;
      }
    } else {
      return null;
    }
  }
  return set;
}

function parseRule(rule: string): Rule | null {
  const r = rule.replace(/\s+/g, " ").trim();
  const empty: Rule = { days: new Set(), off: false, intervals: [] };
  if (!r) return empty;
  // Holiday / school-holiday rules: we don't know the calendar, so skip them.
  if (/\b(PH|SH)\b/.test(r)) return empty;

  const off = /\b(off|closed)\b/i.test(r);
  const times = [...r.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];

  const firstTime = r.search(/\d{1,2}:\d{2}/);
  const firstOff = r.search(/\b(off|closed)\b/i);
  let cut = r.length;
  if (firstTime >= 0) cut = Math.min(cut, firstTime);
  if (firstOff >= 0) cut = Math.min(cut, firstOff);

  const days = parseDays(r.slice(0, cut).trim());
  if (days === null) return null;

  if (off) return { days, off: true, intervals: [] };
  if (times.length === 0) return null;

  const intervals = times.map(
    (m) =>
      [
        Number(m[1]) * 60 + Number(m[2]),
        Number(m[3]) * 60 + Number(m[4]),
      ] as [number, number],
  );
  return { days, off: false, intervals };
}

export function openNow(value: string | undefined, now = new Date()): OpenState {
  if (!value) return "unknown";
  const v = value.trim();
  if (!v) return "unknown";
  if (/^24\/7$/.test(v) || /^open$/i.test(v)) return "open";

  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  let usable = false;
  let open = false;
  for (const raw of v.split(";")) {
    const rule = parseRule(raw);
    if (rule === null) return "unknown";
    const skipped =
      rule.days.size === 0 && rule.intervals.length === 0 && !rule.off;
    if (skipped) continue;
    usable = true;
    if (!rule.days.has(day)) continue;
    if (rule.off) continue;
    for (const [s, e] of rule.intervals) {
      if (e > s) {
        if (minutes >= s && minutes < e) open = true;
      } else if (minutes >= s || minutes < e) {
        // overnight range (e.g. 18:00-02:00), approximated to its start day
        open = true;
      }
    }
  }
  if (!usable) return "unknown";
  return open ? "open" : "closed";
}
