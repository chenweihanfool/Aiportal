import { pgTable, text, boolean, jsonb, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

// 2026-10 — 入口網站「內容層」（設計：kb-pipeline docs/portal-content-design.md）。
// 關係圖譜快照（hermes_graph_snapshot）只有節點與邊；點節點要看的「內容」放這張表：
//   kind = 'event'            doc_key = 事件 id        body_md = 事件正文（frontmatter 之後，不含 H1 標題）
//   kind = 'concept'|'method' doc_key = 概念／方法名稱  body_md = hub 檔本文（候選沒有 hub → 空字串）
//                             meta.refs = 出現脈絡：[{eventId, date, relation?, as?, evidence?}]
// 由 HERMES 的 hermes-graph-pusher.py 以 content_hash 增量 upsert（POST /api/admin/hermes-doc）。
// vault 是唯一真相：這張表是「可全量重建的讀取副本」，清空後重推即可還原，不是資料來源。
// 跟 hermes_timeline_entry 同一套做法：獨立表、可分頁、列表不回傳全文，開單筆才讀。
export const hermesDocTable = pgTable(
  "hermes_doc",
  {
    kind: text("kind").notNull(), // 'event' | 'concept' | 'method'（之後可擴充 person／case／object）
    docKey: text("doc_key").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    truncated: boolean("truncated").notNull().default(false), // 正文超過上限被 pusher 截斷
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    sourcePath: text("source_path"), // vault 相對路徑，診斷用，不對外回傳
    contentHash: text("content_hash").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.docKey] }),
    index("hermes_doc_kind_idx").on(t.kind),
  ],
);

export type HermesDocRow = typeof hermesDocTable.$inferSelect;
