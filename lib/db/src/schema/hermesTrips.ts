import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { HermesPlacePhoto } from "./hermesPlaces";

// 🧳 遊記（2026-10-15）：kb-pipeline 把日記整理成趟次→每日→依時間排列的條目（日記原文）＋相片，整份覆寫推上來。
// 比照地點（hermesPlaces.ts）：入口網只讀、不寫入，權威資料在 HERMES 端，所以只存一列 latest，不保留歷史。
// 驗證規則見 api-server/src/lib/hermesTrips.ts；推送格式見 docs/trips-api.md。
export type HermesTripStatus = "planned" | "ongoing" | "done";

export interface HermesTripEntry {
  time: string; // HH:MM
  text: string; // 日記原文，純文字，保留換行，最長 4000 字
  photos: HermesPlacePhoto[];
  photosPending: number; // 日記裡引用了、但還沒有可用網址的相片張數
}

export interface HermesTripDay {
  date: string; // YYYY-MM-DD，必須落在趟次的 [start, end]
  title: string | null;
  placeIds: string[]; // 對應 hermes-places 的 id
  entries: HermesTripEntry[];
}

export interface HermesTrip {
  id: string;
  name: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD，≥ start
  status: HermesTripStatus;
  area: string | null;
  summary: string | null;
  cover: string | null; // 相片網址（https 或站內路徑）
  placeIds: string[];
  days: HermesTripDay[];
}

export const hermesTripsSnapshotTable = pgTable("hermes_trips_snapshot", {
  id: text("id").primaryKey().default("latest"),
  trips: jsonb("trips").$type<HermesTrip[]>().notNull(),
  generatedAt: text("generated_at"), // HERMES 端產生清單的日期
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesTripsSnapshotRow = typeof hermesTripsSnapshotTable.$inferSelect;
