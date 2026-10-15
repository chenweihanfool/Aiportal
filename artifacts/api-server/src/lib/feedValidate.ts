// 泛用 feed 的請求驗證——純函式，不碰資料庫。請求格式：{ schemaVersion, generatedAt, payload }。
import Ajv, { type ValidateFunction } from "ajv";
import { DEFAULT_MAX_BYTES, FEED_NAME, FEED_REGISTRY, type FeedDef } from "../feeds/registry";

const ajv = new Ajv({ allErrors: false, strict: false });
const compiled = new Map<FeedDef, ValidateFunction>();

function validatorFor(def: FeedDef): ValidateFunction {
  let v = compiled.get(def);
  if (!v) {
    v = ajv.compile(def.schema);
    compiled.set(def, v);
  }
  return v;
}

export type FeedCheck =
  | { ok: true; version: number; generatedAt: string | null; payload: unknown }
  | { ok: false; status: 400 | 404 | 409 | 413; message: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 真的存在的日期（擋掉 2026-02-31：Date.parse 會讓它滾到 3 月，所以要轉回字串比對） */
function realDate(s: string): boolean {
  const t = Date.parse(`${s}T00:00:00Z`);
  return DATE.test(s) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function validateFeedRequest(name: unknown, body: unknown, registry: Record<string, FeedDef> = FEED_REGISTRY): FeedCheck {
  if (typeof name !== "string" || !FEED_NAME.test(name)) return { ok: false, status: 400, message: "feed 名稱不合法" };
  const def = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : undefined;
  if (!def) return { ok: false, status: 404, message: `沒有登記這種 feed：${name}` };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 400, message: "請求本文必須是物件" };
  const b = body as Record<string, unknown>;
  if (b["schemaVersion"] !== def.version) {
    return { ok: false, status: 409, message: `schemaVersion 不符：伺服器是 ${def.version}，收到 ${JSON.stringify(b["schemaVersion"])}` };
  }
  const g = b["generatedAt"];
  if (g !== undefined && g !== null && !(typeof g === "string" && realDate(g))) {
    return { ok: false, status: 400, message: "generatedAt 必須是 YYYY-MM-DD 或 null" };
  }
  if (!("payload" in b)) return { ok: false, status: 400, message: "缺 payload" };
  const size = Buffer.byteLength(JSON.stringify(b["payload"]) ?? "", "utf8");
  if (size > (def.maxBytes ?? DEFAULT_MAX_BYTES)) return { ok: false, status: 413, message: `payload 太大（${size} 位元組，上限 ${def.maxBytes ?? DEFAULT_MAX_BYTES}）` };
  const validate = validatorFor(def);
  if (!validate(b["payload"])) {
    const e = validate.errors?.[0];
    return { ok: false, status: 400, message: `payload 不符 schema：${e?.instancePath || "/"} ${e?.message ?? "invalid"}` };
  }
  return { ok: true, version: def.version, generatedAt: typeof g === "string" ? g : null, payload: b["payload"] };
}
