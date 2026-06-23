import type { Restaurant } from "@/lib/overpass";

export const KINDS = [
  { value: "restaurant", label: "🍽️ 餐厅", short: "餐厅" },
  { value: "fast_food", label: "🍔 快餐", short: "快餐" },
  { value: "cafe", label: "☕ 咖啡/甜品", short: "咖啡/甜品" },
] as const;

// Flavor buckets mapped from OSM `cuisine` keywords (data is sparse, so this is
// a soft filter — places with no/unknown cuisine simply won't match).
export const FLAVORS = [
  {
    key: "heavy",
    label: "Heavy",
    emoji: "🔥",
    desc: "油炸 · 烧烤 · 重口",
    match: [
      "fried",
      "fried_chicken",
      "chicken",
      "burger",
      "pizza",
      "bbq",
      "barbecue",
      "grill",
      "grilled",
      "steak",
      "steak_house",
      "kebab",
      "ramen",
      "curry",
      "hotpot",
      "hot_pot",
      "mala",
      "cheese",
      "american",
      "mexican",
      "pork",
      "sausage",
      "german",
      "fried_rice",
      "fried_noodle",
      "nasi_goreng",
      "donut",
      "wings",
      "fries",
    ],
  },
  {
    key: "light",
    label: "Light",
    emoji: "🥗",
    desc: "清淡 · 蔬食 · 少油",
    match: [
      "salad",
      "sushi",
      "japanese",
      "vegetarian",
      "vegan",
      "healthy",
      "steamed",
      "soup",
      "vietnamese",
      "cantonese",
      "congee",
      "porridge",
      "tofu",
      "juice",
      "fruit",
      "smoothie",
      "tea",
      "sandwich",
      "seafood",
      "dim_sum",
      "breakfast",
      "yong_tau_foo",
      "poke",
      "wrap",
    ],
  },
] as const;

export const CUISINE_ZH: Record<string, string> = {
  chinese: "中餐",
  japanese: "日料",
  korean: "韩餐",
  italian: "意餐",
  pizza: "披萨",
  burger: "汉堡",
  american: "美式",
  thai: "泰餐",
  indian: "印度菜",
  vietnamese: "越南菜",
  french: "法餐",
  mexican: "墨西哥菜",
  seafood: "海鲜",
  noodle: "面食",
  sushi: "寿司",
  ramen: "拉面",
  coffee_shop: "咖啡",
  cafe: "咖啡",
  barbecue: "烧烤",
  vegetarian: "素食",
  dessert: "甜品",
  bakery: "烘焙",
  asian: "亚洲菜",
  steak_house: "牛排",
  malaysian: "马来菜",
  indonesian: "印尼菜",
  curry: "咖喱",
  chicken: "炸鸡",
  sandwich: "三明治",
  ice_cream: "冰淇淋",
  cantonese: "粤菜",
  sichuan: "川菜",
  fried_chicken: "炸鸡",
  pork: "猪肉料理",
};

export function prettyCuisine(c?: string): string | null {
  if (!c) return null;
  return c
    .split(";")
    .map((s) => CUISINE_ZH[s.trim()] ?? s.trim().replace(/_/g, " "))
    .join(" / ");
}

export function prettyDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function matchesFlavor(r: Restaurant, key: string): boolean {
  const flavor = FLAVORS.find((f) => f.key === key);
  if (!flavor) return true;
  const c = (r.cuisine ?? "").toLowerCase();
  if (flavor.match.some((k) => c.includes(k))) return true;
  // Fast food leans "heavy" even without a cuisine tag.
  if (key === "heavy" && r.kind === "fast_food") return true;
  return false;
}

// Cuisine multi-select (uses the cuisine data already in the API response).
export const CUISINES = [
  { key: "chinese", label: "中餐", match: ["chinese", "cantonese", "sichuan", "dim_sum", "noodle", "hotpot"] },
  { key: "malaysian", label: "马来/本地", match: ["malaysian", "mamak", "nasi", "local", "asian", "indonesian"] },
  { key: "japanese", label: "日料", match: ["japanese", "sushi", "ramen"] },
  { key: "korean", label: "韩餐", match: ["korean"] },
  { key: "western", label: "西餐", match: ["western", "american", "italian", "pizza", "steak", "french", "burger"] },
  { key: "indian", label: "印度", match: ["indian", "curry"] },
  { key: "thai", label: "泰餐", match: ["thai"] },
  { key: "drink", label: "咖啡/饮品", match: ["coffee", "cafe", "tea", "bubble_tea", "juice"] },
  { key: "dessert", label: "甜品", match: ["dessert", "cake", "bakery", "ice_cream"] },
] as const;

export function matchesCuisine(r: Restaurant, keys: string[]): boolean {
  if (keys.length === 0) return true;
  const c = (r.cuisine ?? "").toLowerCase();
  return keys.some((key) => {
    const cu = CUISINES.find((x) => x.key === key);
    return cu ? cu.match.some((m) => c.includes(m)) : false;
  });
}

// Price tiers — a crude FREE estimate from venue type + cuisine (no data source
// has real RM prices). The UI labels it "估算".
export const PRICE_TIERS = [
  { key: "cheap", label: "💵 RM20 以下", tier: 1 },
  { key: "mid", label: "💸 RM20–40", tier: 2 },
] as const;

const CHEAP_CUISINE = [
  "malaysian", "mamak", "indian", "chinese", "noodle", "fried", "burger",
  "chicken", "sandwich", "local", "asian", "kopitiam", "nasi", "mee", "roti",
  "hawker", "fried_chicken", "breakfast", "coffee", "tea", "juice", "ice_cream",
  "curry", "indonesian",
];
const PRICEY_CUISINE = [
  "japanese", "korean", "sushi", "ramen", "italian", "pizza", "western",
  "american", "steak", "seafood", "french", "cantonese", "dim_sum", "barbecue",
  "bbq", "grill", "kebab", "mexican", "buffet", "german",
];

export function estPriceTier(r: Restaurant): 1 | 2 {
  const c = (r.cuisine ?? "").toLowerCase();
  if (r.kind === "fast_food") return 1;
  if (CHEAP_CUISINE.some((k) => c.includes(k))) return 1;
  if (PRICEY_CUISINE.some((k) => c.includes(k))) return 2;
  if (r.kind === "cafe") return 1; // drinks/snacks lean cheap
  return 2; // plain sit-down restaurant default
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sampleN<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}
