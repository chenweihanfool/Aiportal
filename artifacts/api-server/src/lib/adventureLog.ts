// 旅遊生活 — reads "recency of the last completed trip" from a self-hosted
// AdventureLog instance (https://github.com/seanmorley15/AdventureLog).
// Unlike mind-index/busyness-index, this doesn't need a host-side collector
// or a Postgres history table: AdventureLog has a public HTTPS API api-server
// can call directly (same pattern as the Vikunja integration), and "days
// since last trip" only ever needs "now" + the most recent completed visit,
// so it's cheap to recompute live on every dashboard request.
//
// Auth confirmed against the real instance: `Authorization: Api-Key <token>`
// (not Bearer) — AdventureLog's API keys use Django REST Framework's
// APIKey scheme, not OAuth-style bearer tokens.
const ADVENTURELOG_API_BASE_URL = process.env["ADVENTURELOG_API_BASE_URL"] ?? "https://adventure.cwh2023.synology.me";
const ADVENTURELOG_API_TOKEN = process.env["ADVENTURELOG_API_TOKEN"];

interface AdventureLogVisit {
  id: string;
  start_date: string;
  end_date: string;
}

export interface TravelIndexData {
  travelScore: number | null;
  daysSinceLastTrip: number | null;
  lastTripEndDate: string | null;
}

// 3 天內剛玩回來 = 滿分；之後線性遞減，約 93 天沒出去玩 = 0 分。使用者明確選
// 了「最近有沒有出去玩」（recency），不是「有計畫中的行程就加分」，所以只看
// 已經結束的行程，還沒發生的行程（is_visited=false 那種）不算。
function scoreFromDaysSince(daysSinceLastTrip: number): number {
  if (daysSinceLastTrip <= 3) return 100;
  return Math.max(0, Math.round(100 - (daysSinceLastTrip - 3) * (100 / 90)));
}

export async function fetchTravelIndex(): Promise<TravelIndexData> {
  if (!ADVENTURELOG_API_TOKEN) {
    throw new Error("ADVENTURELOG_API_TOKEN is not set");
  }

  const res = await fetch(`${ADVENTURELOG_API_BASE_URL}/api/visits/`, {
    headers: { Authorization: `Api-Key ${ADVENTURELOG_API_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`AdventureLog HTTP ${res.status}`);

  const visits = (await res.json()) as AdventureLogVisit[];
  const now = Date.now();

  const completedEndDates = visits
    .map((v) => new Date(v.end_date).getTime())
    .filter((t) => Number.isFinite(t) && t <= now);

  if (completedEndDates.length === 0) {
    // 帳號剛開始用、或還沒有任何已結束的行程——資料不足，不是錯誤，跟其他
    // 指標一樣顯示「資料準備中」而不是編一個假分數。
    return { travelScore: null, daysSinceLastTrip: null, lastTripEndDate: null };
  }

  const lastTripEndMs = Math.max(...completedEndDates);
  const daysSinceLastTrip = Math.floor((now - lastTripEndMs) / (24 * 60 * 60 * 1000));

  return {
    travelScore: scoreFromDaysSince(daysSinceLastTrip),
    daysSinceLastTrip,
    lastTripEndDate: new Date(lastTripEndMs).toISOString(),
  };
}
