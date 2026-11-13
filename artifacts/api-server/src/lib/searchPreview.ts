// GET /api/search/preview 的純邏輯：各 kind 把原始資料推導成 { one, points, related, source, bodyMd }。
// 不碰 DB；資料一律當不可信：欄位型別不對就略過。不回傳 sourcePath。
import {
  SEARCH_KINDS, dateOf, graphEntities, isDocKind, isObj, narrativesOf, str,
  type GraphEntity, type SearchKind,
} from "./search";

export const ONE_MAX = 200;
export const POINT_MAX = 120;
export const POINTS_LIMIT = 5;
export const RELATED_LIMIT = 8;
export const SOURCE_MAX = 120;
export const BODY_MAX = 20000;

export interface PreviewRelated { kind: SearchKind; id: string; title: string }
export interface Preview {
  kind: SearchKind;
  id: string;
  title: string;
  one: string;
  points: string[];
  related: PreviewRelated[];
  source: string;
  bodyMd: string | null;
}

export function validatePreviewParams(kindRaw: unknown, idRaw: unknown): { ok: true; kind: SearchKind; id: string } | { ok: false; message: string } {
  if (typeof kindRaw !== "string" || !(SEARCH_KINDS as readonly string[]).includes(kindRaw)) {
    return { ok: false, message: `kind 必須是 ${SEARCH_KINDS.join("|")} 其中之一` };
  }
  if (typeof idRaw !== "string" || idRaw.length < 1 || idRaw.length > 200) return { ok: false, message: "id 必須是 1～200 字" };
  return { ok: true, kind: kindRaw as SearchKind, id: idRaw };
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const cutBody = (s: string) => cut(s, BODY_MAX);

/** body 裡第一個非空、非標題行（去頭尾空白，截到 200 字）；沒有回空字串。 */
export function firstBodyLine(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#")) return cut(t, ONE_MAX);
  }
  return "";
}

/** 條列清理：去掉句尾 ` ^cNNN`、`[[ ]]`（保留裡面的字，有別名取別名）、`⟦n⟧`。 */
export function cleanPoint(line: string): string {
  const s = line
    .replace(/⟦[^⟧]*⟧/g, "")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .trim()
    .replace(/\s*\^c\d+$/, "")
    .trim();
  return cut(s, POINT_MAX);
}

/** topic 的重點：「## 要注意什麼」（沒有就「## 怎麼做」「## 步驟」）底下前 5 個 `- ` 條列。 */
export function topicPoints(body: string): string[] {
  const lines = body.split(/\r?\n/);
  for (const name of ["要注意什麼", "怎麼做", "步驟"]) {
    const at = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, "").trim() === name);
    if (at < 0) continue;
    const out: string[] = [];
    for (let i = at + 1; i < lines.length && out.length < POINTS_LIMIT; i++) {
      const l = lines[i]!;
      if (/^#{1,6}\s/.test(l)) break;
      const m = /^\s*-\s+(.*)$/.exec(l);
      if (!m) continue;
      const c = cleanPoint(m[1]!);
      if (c) out.push(c);
    }
    return out;
  }
  return [];
}

function addRelated(list: PreviewRelated[], r: PreviewRelated | null): void {
  if (!r || !r.id || list.length >= RELATED_LIMIT) return;
  if (list.some((x) => x.kind === r.kind && x.id === r.id)) return;
  list.push(r);
}

// ── 圖譜事件 ───────────────────────────────────────────────────────────────
interface ParsedEvent {
  id: string; date: string; title: string;
  caseName: string | null; people: string[]; objects: string[]; concepts: string[]; methods: string[];
}
function names(v: unknown, key: string): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v as unknown[]) {
    if (!isObj(x)) continue;
    const n = str(x[key]);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
export function parseEvents(events: unknown): ParsedEvent[] {
  if (!Array.isArray(events)) return [];
  const out: ParsedEvent[] = [];
  for (const ev of events as unknown[]) {
    if (!isObj(ev)) continue;
    const id = str(ev["id"]);
    const date = dateOf(ev["date"]);
    const title = str(ev["title"]);
    if (!id || !date || !title) continue;
    out.push({
      id, date, title, caseName: str(ev["case"]),
      people: names(ev["participants"], "person"), objects: names(ev["objects"], "object"),
      concepts: names(ev["concepts"], "name"), methods: names(ev["methods"], "name"),
    });
  }
  return out;
}

type Graph = { events?: unknown; cases?: unknown; hubNarratives?: unknown };

// ── case／person／object ───────────────────────────────────────────────────
export function previewGraphEntity(graph: Graph, kind: "case" | "person" | "object", name: string): Preview | null {
  const ent: GraphEntity | undefined = graphEntities(graph).find((e) => e.kind === kind && e.name === name);
  const narr = (narrativesOf(graph.hubNarratives).get(`${kind}\u0000${name}`) ?? []);
  if (!ent && narr.length === 0) return null;
  const events = ent?.events ?? [];

  // one：最近一則 hubNarratives（weave 優先）的前 200 字；沒有就「共 N 件事件，最近 YYYY-MM-DD」
  let one = "";
  if (narr.length > 0) {
    const weave = narr.filter((n) => n.type === "weave");
    const pool = weave.length > 0 ? weave : narr;
    const latest = [...pool].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0]!;
    one = cut(latest.text, ONE_MAX);
  } else if (events.length > 0) {
    one = `共 ${events.length} 件事件，最近 ${events[0]!.date}`;
  } else {
    one = "共 0 件事件";
  }

  // related：同在一件事件的其他 case／person／object，依共同事件數多到少
  const ids = new Set(events.map((e) => e.id));
  const counts = new Map<string, { kind: SearchKind; name: string; n: number }>();
  for (const ev of parseEvents(graph.events)) {
    if (!ids.has(ev.id)) continue;
    const peers: Array<[SearchKind, string]> = [];
    if (ev.caseName) peers.push(["case", ev.caseName]);
    ev.people.forEach((p) => peers.push(["person", p]));
    ev.objects.forEach((o) => peers.push(["object", o]));
    for (const [k, n] of peers) {
      if (k === kind && n === name) continue;
      const key = `${k}\u0000${n}`;
      const cur = counts.get(key) ?? { kind: k, name: n, n: 0 };
      cur.n++;
      counts.set(key, cur);
    }
  }
  const order = (k: SearchKind) => SEARCH_KINDS.indexOf(k);
  const related: PreviewRelated[] = [];
  [...counts.values()]
    .sort((a, b) => b.n - a.n || order(a.kind) - order(b.kind) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .forEach((c) => addRelated(related, { kind: c.kind, id: c.name, title: c.name }));

  return {
    kind, id: name, title: name, one,
    points: events.slice(0, POINTS_LIMIT).map((e) => cut(`${e.date} ${e.title}`, POINT_MAX)),
    related,
    source: `${events.length} 件事件`,
    bodyMd: null,
  };
}

// ── topic ─────────────────────────────────────────────────────────────────
export function previewTopic(payload: unknown, id: string): Preview | null {
  if (!isObj(payload) || !Array.isArray(payload["topics"])) return null;
  const t = (payload["topics"] as unknown[]).find((x) => isObj(x) && x["id"] === id);
  if (!isObj(t)) return null;
  const title = str(t["name"]);
  if (!title) return null;
  const body = typeof t["body"] === "string" ? t["body"] : null;
  const why = str(t["why"]);
  const one = why ? cut(why, ONE_MAX) : body ? firstBodyLine(body) : "";

  const related: PreviewRelated[] = [];
  if (Array.isArray(t["related"])) {
    for (const r of t["related"] as unknown[]) {
      if (!isObj(r)) continue;
      const rid = str(r["id"]);
      const rname = str(r["name"]);
      if (rid && rname) addRelated(related, { kind: "topic", id: rid, title: rname });
    }
  }
  const sourceDates: string[] = [];
  let sourceCount = 0;
  if (Array.isArray(t["sources"])) {
    for (const s of t["sources"] as unknown[]) {
      if (!isObj(s)) continue;
      sourceCount++;
      const d = dateOf(s["date"]);
      if (d) sourceDates.push(d);
      const c = str(s["case"]);
      if (c) addRelated(related, { kind: "case", id: c, title: c });
    }
  }
  const latest = sourceDates.sort().pop() ?? dateOf(t["updated"]) ?? dateOf(t["lastSeen"]);
  const source = sourceCount > 0 ? `${sourceCount} 份來源${latest ? `・最近 ${latest}` : ""}` : "";

  return {
    kind: "topic", id, title, one,
    points: body ? topicPoints(body) : [],
    related, source: cut(source, SOURCE_MAX),
    bodyMd: body !== null ? cutBody(body) : null,
  };
}

// ── event／concept／method／source（hermes_doc）──────────────────────────
export interface DocRowInput { kind: unknown; docKey: unknown; title: unknown; bodyMd: unknown; meta: unknown }

export function previewDoc(row: DocRowInput, graph: Graph): Preview | null {
  if (!isDocKind(row.kind)) return null;
  const id = str(row.docKey);
  const title = str(row.title);
  if (!id || !title) return null;
  const body = typeof row.bodyMd === "string" ? row.bodyMd : "";
  const meta = isObj(row.meta) ? row.meta : {};
  const date = dateOf(meta["date"]);
  const events = parseEvents(graph.events);
  const related: PreviewRelated[] = [];
  let source = "";

  if (row.kind === "event") {
    const ev = events.find((e) => e.id === id);
    if (ev) {
      if (ev.caseName) addRelated(related, { kind: "case", id: ev.caseName, title: ev.caseName });
      ev.people.forEach((n) => addRelated(related, { kind: "person", id: n, title: n }));
      ev.objects.forEach((n) => addRelated(related, { kind: "object", id: n, title: n }));
      ev.concepts.forEach((n) => addRelated(related, { kind: "concept", id: n, title: n }));
      ev.methods.forEach((n) => addRelated(related, { kind: "method", id: n, title: n }));
    }
    const diary = Array.isArray(meta["sources"]) && (meta["sources"] as unknown[]).some((s) => isObj(s) && s["type"] === "diary");
    const d = date ?? ev?.date ?? null;
    source = d ? `${diary ? "日記" : "事件"} ${d}` : "";
  } else if (row.kind === "concept" || row.kind === "method") {
    const titles = new Map(events.map((e) => [e.id, e.title]));
    let n = 0;
    if (Array.isArray(meta["refs"])) {
      for (const r of meta["refs"] as unknown[]) {
        if (!isObj(r)) continue;
        const eid = str(r["eventId"]);
        if (!eid) continue;
        n++;
        addRelated(related, { kind: "event", id: eid, title: titles.get(eid) ?? eid });
      }
    }
    source = n > 0 ? `${n} 件事件` : "";
  } else {
    source = date ? `原文 ${date}` : "";
  }

  return {
    kind: row.kind, id, title, one: firstBodyLine(body), points: [], related,
    source: cut(source, SOURCE_MAX), bodyMd: cutBody(body),
  };
}

// ── idea／place／trip／tool ───────────────────────────────────────────────
function findById(list: unknown, id: string): Record<string, unknown> | null {
  if (!Array.isArray(list)) return null;
  for (const x of list as unknown[]) if (isObj(x) && x["id"] === id) return x;
  return null;
}
const plain = (kind: SearchKind, id: string, title: string, one: string, source: string): Preview =>
  ({ kind, id, title, one: cut(one, ONE_MAX), points: [], related: [], source, bodyMd: null });

export function previewIdea(ideas: unknown, id: string): Preview | null {
  const i = findById(ideas, id);
  const title = i && str(i["title"]);
  if (!i || !title) return null;
  return plain("idea", id, title, str(i["why"]) ?? "", "想法庫");
}

export function previewPlace(places: unknown, id: string): Preview | null {
  const p = findById(places, id);
  const title = p && str(p["name"]);
  if (!p || !title) return null;
  const why = str(p["why"]);
  const one = why ?? [str(p["area"]), str(p["cuisine"])].filter((x): x is string => x !== null).join("・");
  return plain("place", id, title, one, "美食地圖");
}

export function previewTrip(trips: unknown, id: string): Preview | null {
  const t = findById(trips, id);
  const title = t && str(t["name"]);
  if (!t || !title) return null;
  return plain("trip", id, title, str(t["summary"]) ?? "", "遊記");
}

export function previewTool(sites: unknown, id: string): Preview | null {
  if (!Array.isArray(sites)) return null;
  for (const s of sites as unknown[]) {
    if (!isObj(s) || String(s["id"]) !== id) continue;
    const title = str(s["name"]);
    if (!title) return null;
    return plain("tool", id, title, typeof s["subtitle"] === "string" ? s["subtitle"].trim() : "", "");
  }
  return null;
}
