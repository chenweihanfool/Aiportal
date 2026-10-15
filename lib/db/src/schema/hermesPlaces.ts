import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// 🍜 美食及旅遊地圖（2026-10-15）：kb-pipeline 把日記與口袋名單萃取成地點清單，整份覆寫推上來。
// 比照想法庫（hermesIdeas.ts）：入口網只顯示、不寫入，權威資料在 HERMES 端，所以只存一列 latest，不保留歷史。
// 欄位與前端 gis-portal/src/foodMap.ts 的 FoodPlace 相同（驗證規則也要一致，見 api-server/src/lib/hermesPlaces.ts）。
export type HermesPlaceKind = "food" | "sight" | "stay" | "other";
export type HermesPlaceStatus = "want" | "visited" | "favorite" | "skip";

export interface HermesPlacePhoto {
  url: string; // https:// 或站內絕對路徑 /…
  thumb: string | null;
  w: number | null;
  h: number | null;
  takenAt: string | null; // YYYY-MM-DD
  caption: string | null;
}

export interface HermesPlace {
  id: string; // FOOD-0001，萃取器配發，跨重跑穩定
  name: string;
  kind: HermesPlaceKind;
  status: HermesPlaceStatus;
  area: string | null;
  address: string | null;
  lat: number; // 必填且合法；沒有座標的地點不收
  lng: number;
  cuisine: string | null;
  tags: string[];
  priceLevel: number | null; // 1-4
  why: string | null;
  source: string | null;
  mustTry: string[];
  rating: number | null; // 1-5
  addedAt: string; // YYYY-MM-DD
  visitedAt: string | null;
  days: string[];
  mapUrl: string | null;
  photos: HermesPlacePhoto[];
}

export const hermesPlacesSnapshotTable = pgTable("hermes_places_snapshot", {
  id: text("id").primaryKey().default("latest"),
  places: jsonb("places").$type<HermesPlace[]>().notNull(),
  generatedAt: text("generated_at"), // HERMES 端產生清單的日期
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesPlacesSnapshotRow = typeof hermesPlacesSnapshotTable.$inferSelect;
