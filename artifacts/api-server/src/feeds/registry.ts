// 泛用 feed 的登記表：每種 feed 一個名字、一個版本、一份 JSON Schema（權威定義在這裡；
// 給推送端用的 JSON 檔放在 repo 根的 schemas/feeds/，由測試保證與這裡一致，見 registry.test.ts）。
// 新增一種資料：在 FEED_REGISTRY 加一筆、跑 `UPDATE_SCHEMAS=1 pnpm --filter @workspace/api-server test` 重新輸出 JSON 檔、
// 推送端用 kbcore.portal_push.push_feed(name, version, payload) 送。不需要新資料表、新路由。
// 改 schema 的規則：欄位只增不改；不相容的改動升 version（舊版本推送會被 409 擋下，直到推送端跟上）。
export interface FeedDef {
  version: number;
  description: string;
  /** payload（JSON 序列化後）的位元組上限；預設 1 MiB */
  maxBytes?: number;
  schema: Record<string, unknown>;
}

export const FEED_NAME = /^[a-z][a-z0-9-]{1,39}$/;
export const DEFAULT_MAX_BYTES = 1024 * 1024;

export const FEED_REGISTRY: Record<string, FeedDef> = {
  // 知識庫架構頁（#architecture）各節點的真實處理數字；推送端 kb-pipeline scripts/arch-stats-pusher.py（每 10 分鐘，只讀計算）。
  "kb-arch-stats": {
    version: 1,
    description: "知識庫架構頁各節點的處理數字：候選、已處理、待處理等（節點 id 對應 architectureData.ts）",
    maxBytes: 64 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "kb-arch-stats feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "nodes"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        nodes: {
          type: "object",
          maxProperties: 40,
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            properties: {
              error: { type: "string", maxLength: 300 },
              metrics: {
                type: "array",
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "value"],
                  properties: {
                    label: { type: "string", minLength: 1, maxLength: 40 },
                    value: { type: ["number", "string"], maxLength: 80 },
                    hint: { type: "string", maxLength: 200 },
                    tone: { enum: ["warn", "crit"] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  // 日／週／月／季／年報的視覺化統計（想法・美食・旅遊）；推送端 kb-pipeline scripts/report-stats-pusher.py（併在推送總管，自己節流成約每小時一次）。
  // 設計見 kb-pipeline docs/report-visual-design.md。目前只推最近 8 週＋6 個月；每份報告的內層欄位由推送端的 kbcore/period_stats.py 定義，
  // 這裡只驗外層形狀（內層由前端 reportsApi.ts 逐欄防呆），之後加欄位不必升 version。
  "kb-report-stats": {
    version: 1,
    description: "週期統計：最近幾週與幾個月的想法、美食、旅遊數字與逐日資料（給報表頁畫圖）",
    maxBytes: 512 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "kb-report-stats feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "reports"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        warnings: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
        reports: {
          type: "array",
          maxItems: 40,
          items: {
            type: "object",
            required: ["period", "range"],
            properties: {
              period: { enum: ["day", "week", "month", "quarter", "year"] },
              range: { type: "array", minItems: 2, maxItems: 2, items: { type: "string", minLength: 10, maxLength: 10 } },
              ideas: { type: "object" },
              food: { type: "object" },
              travel: { type: "object" },
              prev: { type: "object" },
              series: { type: "array", maxItems: 366, items: { type: "object" } },
              meta: { type: "object" },
            },
          },
        },
      },
    },
  },
  // 範例：示範格式與測試用，沒有任何畫面使用它；之後第一個真的新 feed 進來時可以刪掉
  example: {
    version: 1,
    description: "範例 feed：一組標籤與數字（示範格式，沒有畫面使用）",
    maxBytes: 64 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "example feed v1",
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value"],
            properties: {
              label: { type: "string", minLength: 1, maxLength: 80 },
              value: { type: "number" },
              note: { type: ["string", "null"], maxLength: 200 },
            },
          },
        },
      },
    },
  },
};
