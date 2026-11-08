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

// ── topics 的選用欄位 diagram（2026-11-08 起；知識頁的圖解資料）─────────────────────────────
// 契約見任務單 kb-diagram-schema：diagram 為 null 或 flow／timeline／map 三種物件之一。
// 跨欄位規則（id 唯一、邊兩端存在、lane/phase 在範圍內、end ≥ date、src ≤ 來源數、map 連線方向）
// JSON Schema 表達不了，由推送端與前端各自檢查。
const DIAGRAM_ID = { type: "string", pattern: "^[a-z0-9]{1,8}$" };
const DIAGRAM_DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const DIAGRAM_SRC = { type: "array", minItems: 1, maxItems: 6, items: { type: "integer", minimum: 1 } };
// 節點共同欄位（flow 的 nodes、map 的 observations／frameworks／judgments）
const DIAGRAM_NODE = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "src"],
  properties: {
    id: DIAGRAM_ID,
    label: { type: "string", minLength: 1, maxLength: 14 },
    sub: { type: "string", minLength: 0, maxLength: 24 },
    src: DIAGRAM_SRC,
    unknown: { type: "boolean" },
    ai: { type: "boolean" },
    note: { type: "string", minLength: 0, maxLength: 120 },
  },
};
const DIAGRAM_FLOW_NODE = {
  type: "object",
  additionalProperties: false,
  required: [...DIAGRAM_NODE.required, "lane", "phase", "shape"],
  properties: {
    ...DIAGRAM_NODE.properties,
    lane: { type: "integer", minimum: 0 },
    phase: { type: "integer", minimum: 0 },
    shape: { enum: ["step", "decision"] },
    pitfall: { type: "boolean" },
  },
};
const DIAGRAM_FLOW = {
  type: "object",
  additionalProperties: false,
  required: ["type", "version", "lanes", "phases", "nodes", "edges"],
  properties: {
    type: { const: "flow" },
    version: { const: 1 },
    lanes: { type: "array", minItems: 2, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 8 } },
    phases: { type: "array", minItems: 2, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 8 } },
    nodes: { type: "array", minItems: 3, maxItems: 20, items: DIAGRAM_FLOW_NODE },
    edges: {
      type: "array",
      minItems: 2,
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: {
          from: DIAGRAM_ID,
          to: DIAGRAM_ID,
          label: { type: "string", minLength: 0, maxLength: 10 },
          back: { type: "boolean" },
        },
      },
    },
  },
};
const DIAGRAM_TIMELINE = {
  type: "object",
  additionalProperties: false,
  required: ["type", "version", "tracks", "items"],
  properties: {
    type: { const: "timeline" },
    version: { const: 1 },
    tracks: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label"],
        properties: {
          id: DIAGRAM_ID,
          label: { type: "string", minLength: 1, maxLength: 8 },
        },
      },
    },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 80,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["track", "date", "label", "src"],
        properties: {
          track: DIAGRAM_ID,
          date: DIAGRAM_DATE,
          end: DIAGRAM_DATE,
          label: { type: "string", minLength: 1, maxLength: 14 },
          src: DIAGRAM_SRC,
          sub: { type: "string", minLength: 0, maxLength: 24 },
          note: { type: "string", minLength: 0, maxLength: 120 },
          ai: { type: "boolean" },
          unknown: { type: "boolean" },
        },
      },
    },
    metrics: {
      type: "array",
      minItems: 0,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "points"],
        properties: {
          label: { type: "string", minLength: 1, maxLength: 10 },
          unit: { type: "string", minLength: 0, maxLength: 6 },
          points: {
            type: "array",
            minItems: 2,
            maxItems: 40,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["date", "value", "src"],
              properties: {
                date: DIAGRAM_DATE,
                value: { type: "number" },
                src: DIAGRAM_SRC,
              },
            },
          },
        },
      },
    },
  },
};
const DIAGRAM_MAP = {
  type: "object",
  additionalProperties: false,
  required: ["type", "version", "core", "observations", "frameworks", "judgments", "links"],
  properties: {
    type: { const: "map" },
    version: { const: 1 },
    core: { type: "string", minLength: 1, maxLength: 24 },
    observations: { type: "array", minItems: 1, maxItems: 10, items: DIAGRAM_NODE },
    frameworks: { type: "array", minItems: 1, maxItems: 6, items: DIAGRAM_NODE },
    judgments: { type: "array", minItems: 1, maxItems: 10, items: DIAGRAM_NODE },
    links: {
      type: "array",
      minItems: 0,
      maxItems: 60,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to"],
        properties: { from: DIAGRAM_ID, to: DIAGRAM_ID },
      },
    },
  },
};
const DIAGRAM = { oneOf: [{ type: "null" }, DIAGRAM_FLOW, DIAGRAM_TIMELINE, DIAGRAM_MAP] };

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
              events: { type: "integer", minimum: 0 },  // 0＝只有社交紀錄、沒有事件連到人物頁（2026-11-07 起）
              lastEvent: { type: ["string", "null"], maxLength: 120 },
              usualGapDays: { type: ["integer", "null"], minimum: 1, maximum: 3650 },
              overdue: { type: "number", minimum: 0, maximum: 1000 },
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
              names: { type: "array", maxItems: 20, items: { type: "string", maxLength: 60 } },
              types: {
                type: "object",
                additionalProperties: false,
                required: ["face_to_face", "call", "text"],
                properties: {
                  face_to_face: { type: "integer", minimum: 0 },
                  call: { type: "integer", minimum: 0 },
                  text: { type: "integer", minimum: 0 },
                },
              },
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
  // 知識頁（#knowledge）：知識庫自己長出來的主題（題目）、頁面內容、成長紀錄與相關題目。推送端 kb-pipeline 每週產生後推送（契約見 docs/feed-api.md）。
  // 欄位只增不改；body 是頁面四節的 markdown（來源標記為 ⟦n⟧ 腳註，n＝sources 的 1 起算位置）；2.75.0 起含知識樹 tree、每題 branch／path／monthCounts。
  // 2026-11-08 起每題多選用欄位 diagram（null 或 flow／timeline／map，見上方常數）。
  // maxBytes 4 MiB（2026-11-08 起）：既有正文預算約 1.5 MiB（1,572,864 位元組）＋ 64 題 × 一張上限尺寸的圖
  // （上限圖實測最大 27,630 位元組，64 張 1,768,320 位元組，加正文預算估算 3,341,184 位元組；見 topicsDiagram.test.ts 的估算斷言），在 4 MiB（4,194,304）以內；3 MiB 放不下。
  topics: {
    version: 1,
    description: "主題知識頁：知識庫自己長出來的題目、頁面內容、成長紀錄與相關題目",
    maxBytes: 4 * 1024 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "topics feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "total", "published", "topics"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        total: { type: "integer", minimum: 0 },
        published: { type: "integer", minimum: 0 },
        tree: {
          type: "object",
          additionalProperties: false,
          required: ["domains"],
          properties: {
            domains: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "name", "branches"],
                properties: {
                  id: { type: "string", minLength: 1, maxLength: 40 },
                  name: { type: "string", maxLength: 40 },
                  branches: {
                    type: "array",
                    maxItems: 40,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["id", "name", "topics"],
                      properties: {
                        id: { type: "string", minLength: 1, maxLength: 40 },
                        name: { type: "string", maxLength: 40 },
                        topics: { type: "array", maxItems: 300, items: { type: "string", minLength: 1, maxLength: 40 } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        topics: {
          type: "array",
          maxItems: 300,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "kind", "why", "firstSeen", "revision", "docs", "newDocs", "monthsSpan", "body", "growth", "sources", "related"],
            properties: {
              id: { type: "string", minLength: 1, maxLength: 40 },
              name: { type: "string", minLength: 1, maxLength: 60 },
              kind: { enum: ["concept", "method"] },
              why: { type: "string", maxLength: 200 },
              firstSeen: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              lastSeen: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              updated: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              revision: { type: "integer", minimum: 0 },
              docs: { type: "integer", minimum: 0 },
              newDocs: { type: "integer", minimum: 0 },
              monthsSpan: { type: "integer", minimum: 0 },
              firstMonth: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}$" },
              lastMonth: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}$" },
              branch: { type: ["string", "null"], maxLength: 40 },
              path: { type: "array", maxItems: 2, items: { type: "string", maxLength: 40 } },
              monthCounts: {
                type: "array",
                maxItems: 36,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["month", "count"],
                  properties: {
                    month: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
                    count: { type: "integer", minimum: 0 },
                  },
                },
              },
              body: { type: ["string", "null"], maxLength: 13000 },
              growth: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["date", "text"],
                  properties: {
                    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                    text: { type: "string", maxLength: 300 },
                  },
                },
              },
              sources: {
                type: "array",
                maxItems: 40,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "title"],
                  properties: {
                    id: { type: "string", minLength: 1, maxLength: 120 },
                    title: { type: "string", minLength: 1, maxLength: 200 },
                    month: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}$" },
                    // 以下三個為選填（v1 只加選填，舊 payload 不帶也合法）
                    type: { enum: ["pdf", "word", "excel", "image", "text", "diary", "note", "event", "other"] },
                    case: { type: ["string", "null"], maxLength: 60 },
                    date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                  },
                },
              },
              related: {
                type: "array",
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "name"],
                  properties: {
                    id: { type: "string", minLength: 1, maxLength: 40 },
                    name: { type: "string", minLength: 1, maxLength: 60 },
                    sharedDocs: { type: "integer", minimum: 0 },
                    sharedCases: { type: "integer", minimum: 0 },
                  },
                },
              },
              // 選填：知識頁的圖解資料（2026-11-08 起）；舊推送不帶也合法。
              diagram: DIAGRAM,
            },
          },
        },
      },
    },
  },
  // 首頁主動推播主題知識：「今天」卡、明日報告區塊（依報告日）、陪伴區塊的「一年前的這時候」。
  // 推送端 kb-pipeline vikunja-gantt-pusher.py（每 10 分鐘）；matches 只有今天與明天（forDate＝date 或 date+1），recall 為週期喚回。
  "topic-nudges": {
    version: 1,
    description: "首頁主動推播主題知識：今明兩天任務／日記相關的知識頁、去年同期喚回",
    maxBytes: 64 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "topic-nudges feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "date", "matches", "recall"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        matches: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["forDate", "topicId", "name", "path", "published", "point", "triggers", "score"],
            properties: {
              forDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              topicId: { type: "string", minLength: 1, maxLength: 40 },
              name: { type: "string", minLength: 1, maxLength: 80 },
              path: { type: "array", maxItems: 2, items: { type: "string", minLength: 1, maxLength: 40 } },
              published: { type: "boolean" },
              point: { type: "string", minLength: 0, maxLength: 120 },
              triggers: {
                type: "array",
                minItems: 1,
                maxItems: 5,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["kind", "title", "due"],
                  properties: {
                    kind: { enum: ["task", "diary"] },
                    title: { type: "string", minLength: 1, maxLength: 120 },
                    due: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                  },
                },
              },
              score: { type: "integer", minimum: 0, maximum: 100 },
            },
          },
        },
        recall: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["topicId", "name", "path", "published", "point", "reason", "lastMonth", "years"],
            properties: {
              topicId: { type: "string", minLength: 1, maxLength: 40 },
              name: { type: "string", minLength: 1, maxLength: 80 },
              path: { type: "array", maxItems: 2, items: { type: "string", minLength: 1, maxLength: 40 } },
              published: { type: "boolean" },
              point: { type: "string", minLength: 0, maxLength: 120 },
              reason: { type: "string", minLength: 1, maxLength: 80 },
              lastMonth: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}$" },
              years: { type: "array", maxItems: 10, items: { type: "integer", minimum: 2000, maximum: 2100 } },
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
