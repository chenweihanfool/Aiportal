import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// 💡 想法庫（2026-10-09）：日記管線（kb-pipeline 的 ideas-extractor）從日記 💡 標記萃取，
// ideas-pusher 每個 L1 班次整份覆寫推上來。入口網只負責顯示（使用者原話：「入口網站只是顯示介面」），
// 權威資料在 HERMES 端的 pipeline/state/ideas.json，所以這裡只存一列 latest，不保留歷史。
// baseScore 不含「補短板」加成：幸福指數最弱維度只有入口網知道，GET 時才乘上去（routes/hermesIdeas.ts）。
export interface HermesIdea {
  id: string; // IDEA-0001
  title: string;
  category: string | null;
  dimension: string | null; // 類別對到的幸福指數維度（例如「旅遊生活」），補短板用
  source: string | null; // 我／HERMES／Claude
  why: string | null;
  value: number | null; // 1-5，HERMES 估
  effort: number | null; // 1-5，HERMES 估
  status: "new" | "evaluating" | "doing" | "done" | "shelved" | "dropped";
  bornAt: string; // ISO（台北時間）
  lastMentioned: string;
  mentions: number;
  backfill: boolean; // 舊日記回補來的
  days: string[]; // 出現過的日記日期
  history: Array<{ status: string; at: string }>;
  baseScore: number | null; // 已結束的想法為 null
  baseWhy: string[];
}

export interface HermesIdeasWeek {
  weekStart: string; // 週一 YYYY-MM-DD
  born: number;
  done: number;
}

export const hermesIdeasSnapshotTable = pgTable("hermes_ideas_snapshot", {
  id: text("id").primaryKey().default("latest"),
  ideas: jsonb("ideas").$type<HermesIdea[]>().notNull(),
  weeks: jsonb("weeks").$type<HermesIdeasWeek[]>().notNull(),
  generatedAt: text("generated_at"), // HERMES 端計算分數用的日期
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesIdeasSnapshotRow = typeof hermesIdeasSnapshotTable.$inferSelect;
