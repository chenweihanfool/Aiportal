import { Router, type Request, type Response } from "express";
import {
  db, feedSnapshotTable, hermesDocTable, hermesGraphSnapshotTable, hermesIdeasSnapshotTable, hermesPlacesSnapshotTable,
  hermesTripsSnapshotTable, portalSitesTable, searchLogTable,
} from "@workspace/db";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { logger } from "../lib/logger";
import { escapeLike } from "../lib/hermesDocSearch";
import {
  DOC_KINDS, buildStats, createTtlCache, docRowToCandidate, graphToCandidates, ideasToCandidates, isDocKind,
  parseRecentLimit, parseSearchLogBody, parseStatsDays, placesToCandidates, runSearch, sitesToCandidates, topicsToCandidates,
  tripsToCandidates, validateSearchParams, type Candidate, type SearchKind,
} from "../lib/search";
import {
  previewDoc, previewGraphEntity, previewIdea, previewPlace, previewTool, previewTopic, previewTrip,
  validatePreviewParams, type Preview,
} from "../lib/searchPreview";

// 入口網「一個框搜全部」：S1 搜尋、S2 預覽、S3 紀錄、S4 統計。契約見 docs/search-api.md。
// 全部走私領域閘（isAuthorized），沒過回 403。jsonb 快照在程序內快取 30 秒；hermes_doc 走 SQL 不快取。
const router = Router();
const DOC_SQL_LIMIT_PER_KIND = 200;
const FORBIDDEN = { message: "需要解鎖私領域才能查看" };

const cache = createTtlCache();
/** 測試用：清掉 30 秒快取。 */
export function clearSearchCache(): void {
  cache.clear();
}

// 每個來源取不到（表空、查詢失敗）就當 null，該 kind 0 筆，不讓整個搜尋 500。
async function loadSource<T>(name: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await cache.get(name, load);
  } catch (err) {
    logger.error({ err, source: name }, "search source load failed");
    return null;
  }
}

const loadGraph = () => loadSource("graph", async () => {
  const [row] = await db
    .select({ events: hermesGraphSnapshotTable.events, cases: hermesGraphSnapshotTable.cases, hubNarratives: hermesGraphSnapshotTable.hubNarratives })
    .from(hermesGraphSnapshotTable).where(eq(hermesGraphSnapshotTable.id, "latest")).limit(1);
  return row ?? null;
});
const loadTopics = () => loadSource("topics", async () => {
  const [row] = await db.select({ payload: feedSnapshotTable.payload }).from(feedSnapshotTable).where(eq(feedSnapshotTable.name, "topics")).limit(1);
  return row?.payload ?? null;
});
const loadIdeas = () => loadSource("ideas", async () => {
  const [row] = await db.select({ ideas: hermesIdeasSnapshotTable.ideas }).from(hermesIdeasSnapshotTable).where(eq(hermesIdeasSnapshotTable.id, "latest")).limit(1);
  return row?.ideas ?? null;
});
const loadPlaces = () => loadSource("places", async () => {
  const [row] = await db.select({ places: hermesPlacesSnapshotTable.places }).from(hermesPlacesSnapshotTable).where(eq(hermesPlacesSnapshotTable.id, "latest")).limit(1);
  return row?.places ?? null;
});
const loadTrips = () => loadSource("trips", async () => {
  const [row] = await db.select({ trips: hermesTripsSnapshotTable.trips }).from(hermesTripsSnapshotTable).where(eq(hermesTripsSnapshotTable.id, "latest")).limit(1);
  return row?.trips ?? null;
});
const loadSites = () => loadSource("sites", async () =>
  db.select({ id: portalSitesTable.id, name: portalSitesTable.name, subtitle: portalSitesTable.subtitle }).from(portalSitesTable));

// ── S1 ────────────────────────────────────────────────────────────────────
router.get("/search", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const v = validateSearchParams(req.query["q"], req.query["kind"], req.query["limit"]);
  if (!v.ok) return res.status(400).json({ message: v.message });
  const started = Date.now();
  const want = (k: SearchKind) => v.kind === null || v.kind === k;
  const candidates: Partial<Record<SearchKind, Candidate[]>> = {};

  // hermes_doc 的四個 kind：一次 SQL（每個詞 title ILIKE OR body_md ILIKE，詞與詞 AND），排序級別在 JS 算。
  // 每 kind 最多保留 200 筆（為了算 count），SQL 總上限 = 200 × 要查的 kind 數，依 meta.date 新到舊。
  const docKinds = DOC_KINDS.filter(want);
  const docsPromise = docKinds.length === 0 ? Promise.resolve([]) : (async () => {
    try {
      const terms = v.terms.map((t) => {
        const p = `%${escapeLike(t)}%`;
        return or(sql`${hermesDocTable.title} ILIKE ${p}`, sql`${hermesDocTable.bodyMd} ILIKE ${p}`);
      });
      return await db
        .select({ kind: hermesDocTable.kind, docKey: hermesDocTable.docKey, title: hermesDocTable.title, bodyMd: hermesDocTable.bodyMd, meta: hermesDocTable.meta })
        .from(hermesDocTable)
        .where(and(inArray(hermesDocTable.kind, docKinds), ...terms))
        .orderBy(sql`(${hermesDocTable.meta}->>'date') DESC NULLS LAST`)
        .limit(DOC_SQL_LIMIT_PER_KIND * docKinds.length);
    } catch (err) {
      logger.error({ err }, "search hermes_doc query failed");
      return [];
    }
  })();

  const needGraph = want("case") || want("person") || want("object");
  const [docs, graph, topics, ideas, places, trips, sites] = await Promise.all([
    docsPromise,
    needGraph ? loadGraph() : null,
    want("topic") ? loadTopics() : null,
    want("idea") ? loadIdeas() : null,
    want("place") ? loadPlaces() : null,
    want("trip") ? loadTrips() : null,
    want("tool") ? loadSites() : null,
  ]);

  for (const c of graphToCandidates(graph ?? {})) (candidates[c.kind] ??= []).push(c);
  candidates.topic = topicsToCandidates(topics);
  candidates.idea = ideasToCandidates(ideas);
  candidates.place = placesToCandidates(places);
  candidates.trip = tripsToCandidates(trips);
  candidates.tool = sitesToCandidates(sites);
  const perKind = new Map<string, number>();
  for (const row of docs) {
    const c = docRowToCandidate(row);
    if (!c) continue;
    const n = perKind.get(c.kind) ?? 0;
    if (n >= DOC_SQL_LIMIT_PER_KIND) continue;
    perKind.set(c.kind, n + 1);
    (candidates[c.kind] ??= []).push(c);
  }
  if (v.kind !== null) for (const k of Object.keys(candidates) as SearchKind[]) if (k !== v.kind) delete candidates[k];

  const r = runSearch(candidates, v.terms, v.limit);
  return res.json({ q: v.q, total: r.total, tookMs: Date.now() - started, groups: r.groups, best: r.best });
});

// ── S2 ────────────────────────────────────────────────────────────────────
router.get("/search/preview", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const v = validatePreviewParams(req.query["kind"], req.query["id"]);
  if (!v.ok) return res.status(400).json({ message: v.message });

  let p: Preview | null = null;
  switch (v.kind) {
    case "topic": p = previewTopic(await loadTopics(), v.id); break;
    case "case": case "person": case "object": {
      const g = await loadGraph();
      p = g ? previewGraphEntity(g, v.kind, v.id) : null;
      break;
    }
    case "event": case "concept": case "method": case "source": {
      if (!isDocKind(v.kind)) break;
      let row: { kind: string; docKey: string; title: string; bodyMd: string; meta: unknown } | undefined;
      try {
        [row] = await db
          .select({ kind: hermesDocTable.kind, docKey: hermesDocTable.docKey, title: hermesDocTable.title, bodyMd: hermesDocTable.bodyMd, meta: hermesDocTable.meta })
          .from(hermesDocTable)
          .where(and(eq(hermesDocTable.kind, v.kind), eq(hermesDocTable.docKey, v.id)))
          .limit(1);
      } catch (err) {
        logger.error({ err }, "search preview doc query failed");
      }
      if (row) p = previewDoc(row, (await loadGraph()) ?? {});
      break;
    }
    case "idea": p = previewIdea(await loadIdeas(), v.id); break;
    case "place": p = previewPlace(await loadPlaces(), v.id); break;
    case "trip": p = previewTrip(await loadTrips(), v.id); break;
    case "tool": p = previewTool(await loadSites(), v.id); break;
  }
  if (!p) return res.status(404).json({ message: "找不到" });
  return res.json(p);
});

// ── S3 ────────────────────────────────────────────────────────────────────
router.post("/search/log", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const parsed = parseSearchLogBody(req.body);
  if (typeof parsed === "string") return res.status(400).json({ message: parsed });
  const [row] = await db
    .insert(searchLogTable)
    .values({ q: parsed.q, kind: parsed.kind, total: parsed.total, clickedKind: parsed.clickedKind, clickedId: parsed.clickedId })
    .returning({ id: searchLogTable.id });
  return res.status(201).json({ id: row!.id });
});

// ── S4 ────────────────────────────────────────────────────────────────────
router.get("/search/stats", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const days = parseStatsDays(req.query["days"]);
  if (days === null) return res.status(400).json({ message: "days 必須是 1～90 的整數" });
  const since = new Date(Date.now() - days * 86_400_000);
  const inRange = gte(searchLogTable.createdAt, since);
  const [agg] = await db
    .select({
      searches: sql<number>`count(*)::int`,
      zero: sql<number>`(count(*) filter (where ${searchLogTable.total} = 0))::int`,
      clicked: sql<number>`count(${searchLogTable.clickedKind})::int`,
    })
    .from(searchLogTable)
    .where(inRange);
  const zeroQueries = await db
    .select({ q: searchLogTable.q, count: sql<number>`count(*)::int` })
    .from(searchLogTable)
    .where(and(inRange, eq(searchLogTable.total, 0)))
    .groupBy(searchLogTable.q)
    .orderBy(sql`count(*) desc`, searchLogTable.q)
    .limit(10);
  return res.json(buildStats(days, agg?.searches ?? 0, agg?.zero ?? 0, agg?.clicked ?? 0, zeroQueries));
});

// ── S5 ────────────────────────────────────────────────────────────────────
// 最近搜尋的詞（首頁右欄 STATUS 的「最近」小盒）：依 q 去重，用每個詞最後一次出現的時間新到舊。
router.get("/search/recent", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) return res.status(403).json(FORBIDDEN);
  const limit = parseRecentLimit(req.query["limit"]);
  if (limit === null) return res.status(400).json({ message: "limit 必須是 1～20 的整數" });
  const rows = await db
    .select({ q: searchLogTable.q })
    .from(searchLogTable)
    .groupBy(searchLogTable.q)
    .orderBy(sql`max(${searchLogTable.createdAt}) desc`, searchLogTable.q)
    .limit(limit);
  return res.json({ recent: rows.map((r) => r.q) });
});

export default router;
