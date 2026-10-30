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
  // 從容面板（#dim/calm）的任務甘特圖；推送端 kb-pipeline scripts/vikunja-gantt-pusher.py（每 10 分鐘，唯讀 Vikunja）。
  // 日期一律是台北日期 YYYY-MM-DD；選哪些任務見 kb-pipeline kbcore/task_gantt.py。
  "vikunja-gantt": {
    version: 1,
    description: "從容面板的任務甘特圖：Vikunja 未完成與近期完成的任務（開始／結束／到期日）與所屬專案",
    maxBytes: 512 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "vikunja-gantt feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "baseUrl", "projects", "tasks"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        baseUrl: { type: "string", pattern: "^https?://", maxLength: 200 },
        doneDays: { type: "integer", minimum: 0, maximum: 366 },
        undatedOpen: { type: "integer", minimum: 0 },
        truncated: { type: "integer", minimum: 0 },
        projects: {
          type: "array",
          maxItems: 300,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "title"],
            properties: {
              id: { type: "integer", minimum: 1 },
              title: { type: "string", maxLength: 120 },
              color: { type: ["string", "null"], pattern: "^#[0-9a-f]{6}$" },
            },
          },
        },
        tasks: {
          type: "array",
          maxItems: 500,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "title", "projectId", "done"],
            properties: {
              id: { type: "integer", minimum: 1 },
              title: { type: "string", maxLength: 120 },
              projectId: { type: "integer", minimum: 1 },
              start: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              end: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              due: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              done: { type: "boolean" },
              doneAt: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              priority: { type: "integer", minimum: 0, maximum: 5 },
              percentDone: { type: "integer", minimum: 0, maximum: 100 },
            },
          },
        },
      },
    },
  },
  // 日／週／月／季／年報的里程碑（#timeline 報告的 🏁 卡）：每天完成幾項任務。推送端同一支 vikunja-gantt-pusher.py
  // （每 10 分鐘，唯讀 Vikunja；計數規則見 kb-pipeline kbcore/task_gantt.done_by_day）。只送有完成的日子；since＝最早一筆完成日。
  // titles（2026-10-30 起，選填）：最近約 400 天每天附任務標題（每天最多 30 筆），里程碑提示窗逐條列出；舊推送端不帶也照收。
  "tasks-done": {
    version: 1,
    description: "每天完成幾項 Vikunja 任務（台北日期，只列有完成的日子；近期附任務標題），報告里程碑用",
    maxBytes: 1024 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "tasks-done feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "since", "days"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        since: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        days: {
          type: "array",
          maxItems: 4000,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "count"],
            properties: {
              date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              count: { type: "integer", minimum: 1, maximum: 10000 },
              titles: { type: "array", maxItems: 30, items: { type: "string", maxLength: 120 } },
            },
          },
        },
      },
    },
  },
  // 首頁「陪伴」區塊：歷年今天、很久沒聯絡的人、每天有沒有和家人朋友互動。推送端 kb-pipeline scripts/companion-pusher.py
  // （每 10 分鐘，只讀知識庫索引與社交紀錄）。互動沒有列出同事類；socialDays 只列有互動的日子。
  companion: {
    version: 1,
    description: "首頁陪伴區塊：歷年今天、很久沒聯絡的人、近 120 天每天的家人朋友互動",
    maxBytes: 128 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "companion feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "date", "onThisDay", "quietPeople", "socialDays"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        onThisDay: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "kind", "title"],
            properties: {
              date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              kind: { enum: ["event", "report"] },
              title: { type: "string", minLength: 1, maxLength: 120 },
            },
          },
        },
        quietPeople: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "lastDate", "daysQuiet", "events"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 60 },
              lastDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              daysQuiet: { type: "integer", minimum: 0 },
              events: { type: "integer", minimum: 1 },
              lastEvent: { type: ["string", "null"], maxLength: 120 },
            },
          },
        },
        socialDays: {
          type: "array",
          maxItems: 130,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "people"],
            properties: {
              date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              people: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
  },
  // 原本只發 Telegram 的報告（目前是明日報告）。推送端 kb-pipeline scripts/report-publish.py，由報告班次呼叫；每種 key 留最近 7 份。
  "hermes-reports": {
    version: 1,
    description: "原本只發 Telegram 的 HERMES 報告（明日報告等），每種保留最近幾份",
    maxBytes: 512 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "hermes-reports feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "reports"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        reports: {
          type: "array",
          maxItems: 60,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "title", "date", "bodyMd", "createdAt"],
            properties: {
              key: { type: "string", pattern: "^[a-z][a-z0-9-]{1,30}$" },
              title: { type: "string", minLength: 1, maxLength: 80 },
              date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              bodyMd: { type: "string", minLength: 1, maxLength: 20000 },
              createdAt: { type: "string", minLength: 10, maxLength: 40 },
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
