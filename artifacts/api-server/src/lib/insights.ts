// 心得（insight）的純邏輯：把 hermes_doc kind='insight' 的列轉成列表／單筆回應。
// 不碰 DB；routes/insights.ts 只負責撈資料與呼叫這裡。meta 一律當不可信：欄位型別不對就略過那一筆。
import { isRealDate, todayTpe } from "./pushFeedback";
import { isObj, str } from "./search";

const INSIGHT_KEY_RE = /^INS-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/;
const INSIGHT_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const INSIGHT_PROVENANCES = new Set(["quote", "relay", "tag"]);
const INSIGHT_RELATIONS = new Set(["new", "reinforce", "refine", "overturn"]);
const IDEA_KEY_RE = /^IDEA-\d{4,}$/;
const MAX_LINK_PEOPLE = 8;
const MAX_LINK_IDEAS = 6;
const MAX_LINK_TOPICS = 5;

export interface InsightPersonLink {
  id: string;
  name: string;
  dossier: string | null;
  sameSegment: boolean;
}
export interface InsightIdeaLink {
  id: string;
  title: string;
  mentioned: boolean;
}
export interface InsightTopicLink {
  id: string;
  name: string;
}
/** 心得相關的人、想法、知識主題（meta.links）。 */
export interface InsightLinks {
  people: InsightPersonLink[];
  ideas: InsightIdeaLink[];
  topics: InsightTopicLink[];
}

const inLen = (v: unknown, min: number, max: number): boolean => typeof v === "string" && v.length >= min && v.length <= max;

/** 寬容解析 meta.links：壞資料一律略過那一筆（或整個鍵），絕不讓整則心得被略過。 */
export function parseInsightLinks(raw: unknown): InsightLinks {
  const empty: InsightLinks = { people: [], ideas: [], topics: [] };
  if (!isObj(raw)) return empty;
  const out = empty;

  const people = raw["people"];
  if (Array.isArray(people)) {
    const seen = new Set<string>();
    for (const p of people) {
      if (out.people.length >= MAX_LINK_PEOPLE) break;
      if (!isObj(p)) continue;
      const id = p["id"];
      if (!inLen(id, 1, 64) || seen.has(id as string)) continue;
      if (!inLen(p["name"], 1, 40)) continue;
      const dossier = p["dossier"];
      if (dossier !== null && !inLen(dossier, 1, 80)) continue;
      if (typeof p["sameSegment"] !== "boolean") continue;
      seen.add(id as string);
      out.people.push({
        id: id as string, name: p["name"] as string,
        dossier: dossier as string | null, sameSegment: p["sameSegment"] as boolean,
      });
    }
  }

  const ideas = raw["ideas"];
  if (Array.isArray(ideas)) {
    const seen = new Set<string>();
    for (const it of ideas) {
      if (out.ideas.length >= MAX_LINK_IDEAS) break;
      if (!isObj(it)) continue;
      const id = it["id"];
      if (typeof id !== "string" || !IDEA_KEY_RE.test(id) || seen.has(id)) continue;
      if (!inLen(it["title"], 1, 120)) continue;
      if (typeof it["mentioned"] !== "boolean") continue;
      seen.add(id);
      out.ideas.push({ id, title: it["title"] as string, mentioned: it["mentioned"] as boolean });
    }
  }

  const topics = raw["topics"];
  if (Array.isArray(topics)) {
    const seen = new Set<string>();
    for (const t of topics) {
      if (out.topics.length >= MAX_LINK_TOPICS) break;
      if (!isObj(t)) continue;
      const id = t["id"];
      if (!inLen(id, 1, 40) || seen.has(id as string)) continue;
      if (!inLen(t["name"], 1, 60)) continue;
      seen.add(id as string);
      out.topics.push({ id: id as string, name: t["name"] as string });
    }
  }

  return out;
}

export interface InsightItem {
  id: string;
  date: string;
  time: string | null;
  text: string;
  provenance: string;
  cluster: string;
  thread: string;
  relation: string;
  parent: string | null;
  links: InsightLinks;
}

export interface InsightCluster {
  id: string;
  name: string;
  count: number;
}

export interface InsightList {
  total: number;
  thisMonth: number;
  clusters: InsightCluster[];
  insights: InsightItem[];
}

export interface InsightDetail {
  id: string;
  date: string;
  time: string | null;
  text: string;
  evidence: string;
  provenance: string;
  cluster: { id: string; name: string };
  thread: string;
  relation: string;
  parent: string | null;
  source: string | null;
  links: InsightLinks;
  day: { headings: string[] };
  threadItems: InsightItem[];
}

/** 一列 hermes_doc（kind='insight'）；bodyMd 只有單筆查詢需要。 */
export interface InsightRowInput {
  docKey: unknown;
  title: unknown;
  meta: unknown;
  bodyMd?: unknown;
}

interface ParsedInsight extends InsightItem {
  clusterName: string;
  evidence: string;
  source: string | null;
}

/** 通過檢查的一列；不合格回 null。 */
export function parseInsightRow(row: InsightRowInput): ParsedInsight | null {
  const id = str(row.docKey);
  if (!id || !INSIGHT_KEY_RE.test(id)) return null;
  const title = str(row.title);
  if (!title) return null;
  if (!isObj(row.meta)) return null;
  const meta = row.meta;

  const date = typeof meta["date"] === "string" && isRealDate(meta["date"]) ? meta["date"] : null;
  if (!date) return null;

  const timeRaw = meta["time"];
  let time: string | null = null;
  if (timeRaw !== undefined && timeRaw !== null) {
    if (typeof timeRaw !== "string" || !INSIGHT_TIME_RE.test(timeRaw)) return null;
    time = timeRaw;
  }

  const provenance = meta["provenance"];
  if (typeof provenance !== "string" || !INSIGHT_PROVENANCES.has(provenance)) return null;

  const cluster = meta["cluster"];
  if (!isObj(cluster)) return null;
  const clusterId = str(cluster["id"]);
  const clusterName = str(cluster["name"]);
  if (!clusterId || !/^K\d{2}$/.test(clusterId)) return null;
  if (!clusterName || clusterName.length > 12) return null;

  const thread = meta["thread"];
  if (typeof thread !== "string" || !/^TH-[0-9a-f]{8}$/.test(thread)) return null;

  const relation = meta["relation"];
  if (typeof relation !== "string" || !INSIGHT_RELATIONS.has(relation)) return null;

  const parentRaw = meta["parent"];
  let parent: string | null = null;
  if (relation === "new") {
    if (parentRaw !== undefined && parentRaw !== null) return null;
  } else {
    if (typeof parentRaw !== "string" || !INSIGHT_KEY_RE.test(parentRaw)) return null;
    parent = parentRaw;
  }

  return {
    id, date, time, text: title, provenance, cluster: clusterId, thread, relation, parent,
    links: parseInsightLinks(meta["links"]),
    clusterName,
    evidence: typeof row.bodyMd === "string" ? row.bodyMd : "",
    source: str(meta["source"]),
  };
}

const toItem = (p: ParsedInsight): InsightItem => ({
  id: p.id, date: p.date, time: p.time, text: p.text, provenance: p.provenance,
  cluster: p.cluster, thread: p.thread, relation: p.relation, parent: p.parent, links: p.links,
});

/** 由舊到新：date、time（null 視為 00:00）、id。 */
function cmpInsight(a: ParsedInsight, b: ParsedInsight): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const at = a.time ?? "00:00";
  const bt = b.time ?? "00:00";
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 列表回應：clusters 的 name 取該群最新一則的 meta.cluster.name，依 count 多到少、同數依 id；
 * thisMonth 是 date 落在台北時間當月的則數。
 */
export function buildInsightList(rows: InsightRowInput[], now: Date): InsightList {
  const parsed = rows.map(parseInsightRow).filter((r): r is ParsedInsight => r !== null).sort(cmpInsight);
  const byCluster = new Map<string, InsightCluster>();
  for (const p of parsed) {
    const cur = byCluster.get(p.cluster);
    if (cur) {
      cur.count++;
      cur.name = p.clusterName; // 由舊到新走訪，最後留下的是最新一則的群名
    } else {
      byCluster.set(p.cluster, { id: p.cluster, name: p.clusterName, count: 1 });
    }
  }
  const clusters = [...byCluster.values()].sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ym = todayTpe(now).slice(0, 7);
  const thisMonth = parsed.filter((p) => p.date.slice(0, 7) === ym).length;
  return { total: parsed.length, thisMonth, clusters, insights: parsed.map(toItem) };
}

/** 單筆回應：同 thread 的全部心得（含自己）由舊到新；找不到（或那一筆 meta 壞掉）回 null。 */
export function buildInsightDetail(rows: InsightRowInput[], id: string, dayHeadingList: string[] = []): InsightDetail | null {
  const parsed = rows.map(parseInsightRow).filter((r): r is ParsedInsight => r !== null).sort(cmpInsight);
  const self = parsed.find((p) => p.id === id);
  if (!self) return null;
  const { cluster, ...item } = toItem(self);
  return {
    ...item,
    evidence: self.evidence,
    cluster: { id: cluster, name: self.clusterName },
    source: self.source,
    day: { headings: dayHeadingList },
    threadItems: parsed.filter((p) => p.thread === self.thread).map(toItem),
  };
}

const HEADING_SKIP_WORDS = [
  "角色點評", "多維度", "精煉洞察", "早安報告", "明日報告", "今日評分", "快掃", "圖譜", "心智指標", "週報", "月報",
  "派單", "🤖 Claude Code", "部署", "修復", "commit", "cron", "排程",
];
const HEADING_SKIP_RES = [/L[1-5](?![0-9])/, /PR(?![A-Za-z])/];
const MAX_DAY_HEADINGS = 8;
const MAX_HEADING_LEN = 30;

/** 從當天日記抽出「那天的幾件事」：### 標題去掉開頭時間、排除系統／點評類標題，截 30 字、去重、最多 8 條。 */
export function dayHeadings(bodyMd: string): string[] {
  if (typeof bodyMd !== "string") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of bodyMd.split(/\r?\n/)) {
    if (out.length >= MAX_DAY_HEADINGS) break;
    if (!line.startsWith("### ")) continue;
    const title = line.slice(4).replace(/^\s*\d{1,2}[:：]\d{2}\s*/, "").trim();
    if (!title) continue;
    if (HEADING_SKIP_WORDS.some((w) => title.includes(w)) || HEADING_SKIP_RES.some((re) => re.test(title))) continue;
    const chars = [...title];
    const cut = chars.length > MAX_HEADING_LEN ? `${chars.slice(0, MAX_HEADING_LEN).join("")}…` : title;
    if (seen.has(cut)) continue;
    seen.add(cut);
    out.push(cut);
  }
  return out;
}
