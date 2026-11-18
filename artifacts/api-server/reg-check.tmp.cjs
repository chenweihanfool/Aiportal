"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/feeds/registry.ts
var registry_exports = {};
__export(registry_exports, {
  DEFAULT_MAX_BYTES: () => DEFAULT_MAX_BYTES,
  FEED_NAME: () => FEED_NAME,
  FEED_REGISTRY: () => FEED_REGISTRY
});
module.exports = __toCommonJS(registry_exports);
var FEED_NAME = /^[a-z][a-z0-9-]{1,39}$/;
var DEFAULT_MAX_BYTES = 1024 * 1024;
var DIAGRAM_ID = { type: "string", pattern: "^[a-z0-9]{1,8}$" };
var DIAGRAM_DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
var DIAGRAM_SRC = { type: "array", minItems: 1, maxItems: 6, items: { type: "integer", minimum: 1 } };
var DIAGRAM_NODE = {
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
    note: { type: "string", minLength: 0, maxLength: 120 }
  }
};
var DIAGRAM_FLOW_NODE = {
  type: "object",
  additionalProperties: false,
  required: [...DIAGRAM_NODE.required, "lane", "phase", "shape"],
  properties: {
    ...DIAGRAM_NODE.properties,
    lane: { type: "integer", minimum: 0 },
    phase: { type: "integer", minimum: 0 },
    shape: { enum: ["step", "decision"] },
    pitfall: { type: "boolean" }
  }
};
var DIAGRAM_FLOW = {
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
          back: { type: "boolean" }
        }
      }
    }
  }
};
var DIAGRAM_TIMELINE = {
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
          label: { type: "string", minLength: 1, maxLength: 8 }
        }
      }
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
          unknown: { type: "boolean" }
        }
      }
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
                src: DIAGRAM_SRC
              }
            }
          }
        }
      }
    }
  }
};
var DIAGRAM_MAP = {
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
        properties: { from: DIAGRAM_ID, to: DIAGRAM_ID }
      }
    }
  }
};
var DIAGRAM = { oneOf: [{ type: "null" }, DIAGRAM_FLOW, DIAGRAM_TIMELINE, DIAGRAM_MAP] };
var CALENDAR_TIME = "^(\\d{4}-\\d{2}-\\d{2}|\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?(Z|[+-]\\d{2}:?\\d{2}))$";
var FEED_REGISTRY = {
  // 知識庫架構頁（#architecture）各節點的真實處理數字；推送端 kb-pipeline scripts/arch-stats-pusher.py（每 10 分鐘，只讀計算）。
  "kb-arch-stats": {
    version: 1,
    description: "\u77E5\u8B58\u5EAB\u67B6\u69CB\u9801\u5404\u7BC0\u9EDE\u7684\u8655\u7406\u6578\u5B57\uFF1A\u5019\u9078\u3001\u5DF2\u8655\u7406\u3001\u5F85\u8655\u7406\u7B49\uFF08\u7BC0\u9EDE id \u5C0D\u61C9 architectureData.ts\uFF09",
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
                    tone: { enum: ["warn", "crit"] }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  // 從容面板（#dim/calm）的任務甘特圖；推送端 kb-pipeline scripts/vikunja-gantt-pusher.py（每 10 分鐘，唯讀 Vikunja）。
  // 日期一律是台北日期 YYYY-MM-DD；選哪些任務見 kb-pipeline kbcore/task_gantt.py。
  "vikunja-gantt": {
    version: 1,
    description: "\u5F9E\u5BB9\u9762\u677F\u7684\u4EFB\u52D9\u7518\u7279\u5716\uFF1AVikunja \u672A\u5B8C\u6210\u8207\u8FD1\u671F\u5B8C\u6210\u7684\u4EFB\u52D9\uFF08\u958B\u59CB\uFF0F\u7D50\u675F\uFF0F\u5230\u671F\u65E5\uFF09\u8207\u6240\u5C6C\u5C08\u6848",
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
              color: { type: ["string", "null"], pattern: "^#[0-9a-f]{6}$" }
            }
          }
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
              percentDone: { type: "integer", minimum: 0, maximum: 100 }
            }
          }
        }
      }
    }
  },
  // 日／週／月／季／年報的里程碑（#timeline 報告的 🏁 卡）：每天完成幾項任務。推送端同一支 vikunja-gantt-pusher.py
  // （每 10 分鐘，唯讀 Vikunja；計數規則見 kb-pipeline kbcore/task_gantt.done_by_day）。只送有完成的日子；since＝最早一筆完成日。
  // titles（2026-10-30 起，選填）：最近約 400 天每天附任務標題（每天最多 30 筆），里程碑提示窗逐條列出；舊推送端不帶也照收。
  "tasks-done": {
    version: 1,
    description: "\u6BCF\u5929\u5B8C\u6210\u5E7E\u9805 Vikunja \u4EFB\u52D9\uFF08\u53F0\u5317\u65E5\u671F\uFF0C\u53EA\u5217\u6709\u5B8C\u6210\u7684\u65E5\u5B50\uFF1B\u8FD1\u671F\u9644\u4EFB\u52D9\u6A19\u984C\uFF09\uFF0C\u5831\u544A\u91CC\u7A0B\u7891\u7528",
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
          maxItems: 4e3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["date", "count"],
            properties: {
              date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              count: { type: "integer", minimum: 1, maximum: 1e4 },
              titles: { type: "array", maxItems: 30, items: { type: "string", maxLength: 120 } }
            }
          }
        }
      }
    }
  },
  // 首頁「陪伴」區塊：歷年今天、很久沒聯絡的人、每天有沒有和家人朋友互動。推送端 kb-pipeline scripts/companion-pusher.py
  // （每 10 分鐘，只讀知識庫索引與社交紀錄）。互動沒有列出同事類；socialDays 只列有互動的日子。
  companion: {
    version: 1,
    description: "\u9996\u9801\u966A\u4F34\u5340\u584A\uFF1A\u6B77\u5E74\u4ECA\u5929\u3001\u5F88\u4E45\u6C92\u806F\u7D61\u7684\u4EBA\u3001\u8FD1 120 \u5929\u6BCF\u5929\u7684\u5BB6\u4EBA\u670B\u53CB\u4E92\u52D5",
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
              title: { type: "string", minLength: 1, maxLength: 120 }
            }
          }
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
              events: { type: "integer", minimum: 0 },
              // 0＝只有社交紀錄、沒有事件連到人物頁（2026-11-07 起）
              lastEvent: { type: ["string", "null"], maxLength: 120 },
              usualGapDays: { type: ["integer", "null"], minimum: 1, maximum: 3650 },
              overdue: { type: "number", minimum: 0, maximum: 1e3 }
            }
          }
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
                  text: { type: "integer", minimum: 0 }
                }
              }
            }
          }
        }
      }
    }
  },
  // 原本只發 Telegram 的報告（目前是明日報告）。推送端 kb-pipeline scripts/report-publish.py，由報告班次呼叫；每種 key 留最近 7 份。
  "hermes-reports": {
    version: 1,
    description: "\u539F\u672C\u53EA\u767C Telegram \u7684 HERMES \u5831\u544A\uFF08\u660E\u65E5\u5831\u544A\u7B49\uFF09\uFF0C\u6BCF\u7A2E\u4FDD\u7559\u6700\u8FD1\u5E7E\u4EFD",
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
              bodyMd: { type: "string", minLength: 1, maxLength: 2e4 },
              createdAt: { type: "string", minLength: 10, maxLength: 40 }
            }
          }
        }
      }
    }
  },
  // 知識頁（#knowledge）：知識庫自己長出來的主題（題目）、頁面內容、成長紀錄與相關題目。推送端 kb-pipeline 每週產生後推送（契約見 docs/feed-api.md）。
  // 欄位只增不改；body 是頁面四節的 markdown（來源標記為 ⟦n⟧ 腳註，n＝sources 的 1 起算位置）；2.75.0 起含知識樹 tree、每題 branch／path／monthCounts。
  // 2026-11-08 起每題多選用欄位 diagram（null 或 flow／timeline／map，見上方常數）。
  // maxBytes 4 MiB（2026-11-08 起）：既有正文預算約 1.5 MiB（1,572,864 位元組）＋ 64 題 × 一張上限尺寸的圖
  // （上限圖實測最大 27,630 位元組，64 張 1,768,320 位元組，加正文預算估算 3,341,184 位元組；見 topicsDiagram.test.ts 的估算斷言），在 4 MiB（4,194,304）以內；3 MiB 放不下。
  topics: {
    version: 1,
    description: "\u4E3B\u984C\u77E5\u8B58\u9801\uFF1A\u77E5\u8B58\u5EAB\u81EA\u5DF1\u9577\u51FA\u4F86\u7684\u984C\u76EE\u3001\u9801\u9762\u5167\u5BB9\u3001\u6210\u9577\u7D00\u9304\u8207\u76F8\u95DC\u984C\u76EE",
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
                        topics: { type: "array", maxItems: 300, items: { type: "string", minLength: 1, maxLength: 40 } }
                      }
                    }
                  }
                }
              }
            }
          }
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
                    count: { type: "integer", minimum: 0 }
                  }
                }
              },
              body: { type: ["string", "null"], maxLength: 13e3 },
              growth: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["date", "text"],
                  properties: {
                    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                    text: { type: "string", maxLength: 300 }
                  }
                }
              },
              sources: {
                type: "array",
                maxItems: 120,
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
                    date: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
                  }
                }
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
                    sharedCases: { type: "integer", minimum: 0 }
                  }
                }
              },
              // 選填：知識頁的圖解資料（2026-11-08 起）；舊推送不帶也合法。
              diagram: DIAGRAM,
              // 選填：頁面上的每一條與統計、已套用的更正（2026-11-12 起）；舊推送不帶也合法。
              claims: {
                type: "array",
                maxItems: 300,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "section", "status", "origin", "pinned", "firstSeen", "lastChanged", "text"],
                  properties: {
                    id: { type: "string", pattern: "^c[0-9]{3,5}$" },
                    section: { type: "string", minLength: 1, maxLength: 40 },
                    status: { type: "string", enum: ["active", "disputed"] },
                    origin: { type: "string", enum: ["model", "user"] },
                    pinned: { type: "boolean" },
                    firstSeen: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
                    lastChanged: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
                    text: { type: "string", minLength: 1, maxLength: 2e3 }
                  }
                }
              },
              claimStats: {
                type: "object",
                additionalProperties: false,
                required: ["active", "retired", "disputed", "user"],
                properties: {
                  active: { type: "integer", minimum: 0 },
                  retired: { type: "integer", minimum: 0 },
                  disputed: { type: "integer", minimum: 0 },
                  user: { type: "integer", minimum: 0 }
                }
              },
              appliedCorrections: { type: "array", maxItems: 200, items: { type: "integer", minimum: 1 } }
            }
          }
        }
      }
    }
  },
  // 首頁主動推播主題知識：「今天」卡、明日報告區塊（依報告日）、陪伴區塊的「一年前的這時候」。
  // 推送端 kb-pipeline vikunja-gantt-pusher.py（每 10 分鐘）；matches 只有今天與明天（forDate＝date 或 date+1），recall 為週期喚回。
  // 2026-11-13 起的選填欄位：matches 每筆可帶 why／at／matchedBy／caseName、頂層可帶 resumes（上限 8→16；
  // 舊 payload 不帶這些仍合法，v1 不升版）。
  "topic-nudges": {
    version: 1,
    description: "\u9996\u9801\u4E3B\u52D5\u63A8\u64AD\u4E3B\u984C\u77E5\u8B58\uFF1A\u4ECA\u660E\u5169\u5929\u4EFB\u52D9\uFF0F\u65E5\u8A18\u76F8\u95DC\u7684\u77E5\u8B58\u9801\u3001\u53BB\u5E74\u540C\u671F\u559A\u56DE",
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
          maxItems: 16,
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
                    due: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" }
                  }
                }
              },
              score: { type: "integer", minimum: 0, maximum: 100 },
              // 以下四個為選填（2026-11-13 起；舊推送不帶也合法）。
              why: { type: "string", minLength: 1, maxLength: 160 },
              at: { type: ["string", "null"], pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
              matchedBy: { enum: ["case", "terms"] },
              caseName: { type: ["string", "null"], minLength: 1, maxLength: 80 }
            }
          }
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
              years: { type: "array", maxItems: 10, items: { type: "integer", minimum: 2e3, maximum: 2100 } }
            }
          }
        },
        // 選填（2026-11-13 起）：今日 resume 卡；舊推送不帶也合法。
        resumes: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["forDate", "at", "caseName", "quietDays", "why", "events"],
            properties: {
              forDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              at: { type: ["string", "null"], pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" },
              caseName: { type: "string", minLength: 1, maxLength: 80 },
              quietDays: { type: "integer", minimum: 0 },
              why: { type: "string", minLength: 1, maxLength: 160 },
              events: {
                type: "array",
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["date", "title"],
                  properties: {
                    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                    title: { type: "string", minLength: 1, maxLength: 120 }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  // 首頁「今天的行程」卡片：只收標題、開始／結束時間、地點文字，不含與會者、描述、會議連結（私領域才看得到）。
  // 推送端與前端卡片另行施工；日期一律是台北日期 YYYY-MM-DD。
  "calendar-today": {
    version: 1,
    description: "\u4ECA\u5929\u7684\u884C\u7A0B\uFF1A\u53EA\u6709\u6A19\u984C\u3001\u958B\u59CB\uFF0F\u7D50\u675F\u6642\u9593\u3001\u5730\u9EDE\u6587\u5B57\uFF1B\u4E0D\u542B\u8207\u6703\u8005\u3001\u63CF\u8FF0\u3001\u6703\u8B70\u9023\u7D50\uFF08\u53F0\u5317\u65E5\u671F\uFF09",
    maxBytes: 64 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "calendar-today feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "date", "events"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        events: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["start", "end", "allDay", "title", "location"],
            properties: {
              start: { type: "string", pattern: CALENDAR_TIME },
              end: { type: ["string", "null"], pattern: CALENDAR_TIME },
              allDay: { type: "boolean" },
              title: { type: "string", minLength: 1, maxLength: 120 },
              location: { type: ["string", "null"], maxLength: 120 }
            }
          }
        }
      }
    }
  },
  // 公文範本索引（3.9.0）：檔案本身在家中 NAS 的唯讀掛載（root＋rel），這裡只送索引。
  // 推送端 kb-pipeline 掃描範本資料夾後推送；下載走 GET /api/templates/:id/file（TEMPLATE_ROOTS 對照根目錄代號）。
  templates: {
    version: 1,
    description: "\u516C\u6587\u7BC4\u672C\u7D22\u5F15\uFF1A\u6A94\u540D\u3001\u5BB6\u65CF\u3001\u985E\u5225\u3001\u6587\u4EF6\u985E\u578B\u3001\u7248\u672C\u3001\u5225\u540D\u8207\u6A94\u6848\u4F4D\u7F6E\uFF08root\uFF0Brel\uFF09\uFF0C\u4F9B\u641C\u5C0B\u8207\u4E0B\u8F09",
    maxBytes: 1024 * 1024,
    schema: {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "templates feed v1",
      type: "object",
      additionalProperties: false,
      required: ["computedAt", "total", "problems", "templates"],
      properties: {
        computedAt: { type: "string", minLength: 10, maxLength: 40 },
        total: { type: "integer", minimum: 0 },
        problems: { type: "integer", minimum: 0 },
        templates: {
          type: "array",
          maxItems: 1e3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "family", "category", "docType", "subject", "version", "latest", "aliases", "root", "rel", "ext", "size", "copies"],
            properties: {
              id: { type: "string", pattern: "^tpl_[0-9a-f]{10}$" },
              name: { type: "string", minLength: 1, maxLength: 120 },
              family: { type: "string", minLength: 1, maxLength: 60 },
              category: { type: "string", minLength: 1, maxLength: 20 },
              docType: { enum: ["\u51FD", "\u7C3D", "\u66F8\u51FD", "\u516C\u544A", "\u4FBF\u7C3D", "\u5176\u4ED6\u516C\u6587", "\u5716\u8868", "\u8868\u55AE", "\u5176\u4ED6"] },
              subject: { type: ["string", "null"], maxLength: 200 },
              version: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
              latest: { type: "boolean" },
              aliases: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 20 } },
              root: { type: "string", pattern: "^[a-z][a-z0-9-]{0,19}$" },
              rel: { type: "string", minLength: 1, maxLength: 260 },
              ext: { enum: ["json", "docx", "doc", "odt", "pdf", "xlsx"] },
              size: { type: "integer", minimum: 0 },
              copies: { type: "integer", minimum: 1 }
            }
          }
        }
      }
    }
  },
  // 範例：示範格式與測試用，沒有任何畫面使用它；之後第一個真的新 feed 進來時可以刪掉
  example: {
    version: 1,
    description: "\u7BC4\u4F8B feed\uFF1A\u4E00\u7D44\u6A19\u7C64\u8207\u6578\u5B57\uFF08\u793A\u7BC4\u683C\u5F0F\uFF0C\u6C92\u6709\u756B\u9762\u4F7F\u7528\uFF09",
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
              note: { type: ["string", "null"], maxLength: 200 }
            }
          }
        }
      }
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_MAX_BYTES,
  FEED_NAME,
  FEED_REGISTRY
});
