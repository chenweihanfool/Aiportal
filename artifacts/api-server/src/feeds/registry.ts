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
