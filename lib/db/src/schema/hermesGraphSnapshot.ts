import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// HERMES's "事人雙實體" (event-person dual-entity) knowledge structure,
// 2026-09-03 — Events/*.md frontmatter is the single source of truth
// (`participants: [{person, role}]`); People/*.md is just a derived,
// script-maintained backlink cache on HERMES's own side, so this only ever
// stores the events array. People nodes, edges, and every derived metric
// (peopleCount, orphan ratio, most-active person, ...) are computed from
// `events` at read time in routes/hermesStatus.ts's GET handler — nothing
// here is pre-aggregated, so a schema/metric change never needs a backfill.
//
// 2026-09-16 — 架構擴大為「事人物三實體 + 案件脈絡層」（見 L1~L5 架構圖）。
// `case`（2026-09-14 v2.3.3 已加）跟這裡新加的 `objects` 都是 Events
// frontmatter 自己的欄位（`case: "[[案件名稱]]"`、`objects: [{object,
// object_type}]`），跟 participants 同樣直接躺在事件本身，所以案件節點／
// 物件節點／事件↔案件／事件↔物件邊全部沿用「只存 events，其他都在讀取時從
// events 反推」的既有原則，不需要另外掃 Cases/*.md 或 Objects/*.md 本身。
// - 唯一的例外是 `personRelations`（人↔人邊）：這是 People/*.md 的
//   `## 關係人物` 區塊記的東西，不是 Events 的欄位，Events 完全沒有
//   「人跟人怎麼認識」這種資訊，所以這塊沒有 events-derive 的替代方案，
//   只能單獨存一份 collect.ps1 從 People/*.md 掃出來的關聯陣列。
// - `cases` 只存 Cases/*.md frontmatter 的 name/status（11 個檔案，規模小、
//   格式穩定），單純是給案件節點補一個「目前狀態」的顯示用途，不是拓撲的
//   必要資料——就算這欄位是空的，案件節點還是能從 events 的 case 欄位反推
//   出來，只是狀態顯示不出來而已。
export const hermesGraphSnapshotTable = pgTable("hermes_graph_snapshot", {
  id: text("id").primaryKey().default("latest"),
  events: jsonb("events").$type<
    Array<{
      id: string;
      date: string; // YYYY-MM-DD
      title: string;
      caseNo: string | null;
      case: string | null; // 案件 wikilink 名（`case: "[[案件名]]"` 內的名字），判斷「真孤兒」與案件節點用
      location: string | null;
      status: string | null;
      tags: string[];
      participants: Array<{ person: string; role: string }>;
      objects: Array<{ object: string; objectType: string | null }>;
    }>
  >(),
  personRelations: jsonb("person_relations").$type<
    Array<{ from: string; to: string; description: string }>
  >(),
  cases: jsonb("cases").$type<Array<{ name: string; status: string | null }>>(),
  // 2026-09-19 — L5 轉型「圖譜編織層」：樞紐檔（People/Objects/Cases）新增
  // 「## 圖譜敘事」區塊（`L5-WEAVE：` 前綴，增補、永不收斂），「## 🧠 脈絡
  // 洞察」／Cases 的「## 🧠 案件脈絡與目前進度」則改成只放時效警報
  // （`L5：` 前綴）。跟 personRelations 同一種例外：這是樞紐檔本文才有的
  // 敘述文字，Events 完全沒有這個資訊，沒有 events-derive 的替代方案，只
  // 能單獨掃、單獨存。兩種前綴合併存成一個陣列（用 type 分辨），不是兩個
  // 欄位——圖譜敘事這層 2026-09-19 才剛啟用，目前 vault 裡幾乎是空的，只
  // 存這個欄位的話部署當下畫面什麼都不會有；合併現有的警報內容（23 則真
  // 實資料）進來，才有東西可以顯示，之後圖譜敘事開始寫也會自動混進同一個
  // 時間軸。collect.ps1 每個樞紐只送最新 20 則（見 collect.ps1 的說明），
  // 防止「永不收斂」的敘事量隨時間把整包 payload 撐大到頂到 body limit。
  hubNarratives: jsonb("hub_narratives").$type<
    Array<{
      hub: string; // 樞紐節點名稱（人名／案件名／物件名），跟 events.participants／case／objects.object 的名稱同一套 key
      kind: "person" | "case" | "object";
      date: string; // YYYY-MM-DD
      type: "weave" | "alert"; // weave = 圖譜敘事（L5-WEAVE，增補式編織），alert = 🧠 時效警報（L5）
      text: string;
    }>
  >(),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HermesGraphSnapshotRow = typeof hermesGraphSnapshotTable.$inferSelect;
export type HermesGraphEvent = NonNullable<HermesGraphSnapshotRow["events"]>[number];
export type HermesGraphPersonRelation = NonNullable<HermesGraphSnapshotRow["personRelations"]>[number];
export type HermesGraphCaseMeta = NonNullable<HermesGraphSnapshotRow["cases"]>[number];
export type HermesGraphHubNarrative = NonNullable<HermesGraphSnapshotRow["hubNarratives"]>[number];
