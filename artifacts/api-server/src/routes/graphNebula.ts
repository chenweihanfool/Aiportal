// GET /api/graph/nebula — 知識圖譜「星雲圖」資料。
// 來源：LightRAG 寫入的 Neo4j（container neo4j-kg），節點只有 entity_id /
// entity_type / description，關係型別固定是 DIRECTED、語意放在 r.keywords。
// 這裡把 degree 當節點大小、entity_type 當顏色分類，關係標籤取 keywords。
// 用無向比對：只算 outgoing 會把「只被指向」的葉節點濾掉，links 又指到不存在的節點。
import { Router, type Request, type Response } from "express";
import neo4j, { type Driver } from "neo4j-driver";
import { logger } from "../lib/logger";

const router = Router();

const NEO4J_URI = process.env.NEO4J_URI ?? "bolt://neo4j-kg:7687";
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "";
const CACHE_TTL_MS = 60_000;

const NEBULA_CYPHER = `
MATCH (n)
WHERE n.entity_id IS NOT NULL
OPTIONAL MATCH (n)-[r]-(m)
WITH n, count(r) AS degree,
     collect(DISTINCT CASE
       WHEN m IS NULL OR m.entity_id IS NULL THEN null
       ELSE {source: elementId(n), target: elementId(m), label: coalesce(r.keywords, type(r))}
     END) AS raw
WHERE degree > 0
RETURN collect(DISTINCT {
         id: elementId(n),
         name: n.entity_id,
         type: coalesce(n.entity_type, 'unknown'),
         val: degree,
         description: coalesce(n.description, '')
       }) AS nodes,
       reduce(acc = [], l IN collect(raw) | acc + [x IN l WHERE x IS NOT NULL]) AS links
`;

let driver: Driver | null = null;
let cache: { at: number; payload: unknown } | null = null;

function getDriver(): Driver | null {
  if (!NEO4J_PASSWORD) return null;
  if (!driver) {
    driver = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD),
      // Neo4j 的 count() 是 Integer 物件；前端要的是純數字（nodeVal 直接參與半徑計算）
      { maxConnectionPoolSize: 4, connectionTimeout: 5000, disableLosslessIntegers: true },
    );
  }
  return driver;
}

router.get("/graph/nebula", async (_req: Request, res: Response) => {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("X-Cache", "HIT");
    res.json(cache.payload);
    return;
  }

  const d = getDriver();
  if (!d) {
    res.status(503).json({ nodes: [], links: [], error: "graph backend not configured" });
    return;
  }

  const session = d.session();
  try {
    const result = await session.run(NEBULA_CYPHER);
    const rec = result.records[0];
    // 無向比對會讓同一條關係從兩端各回一次；用無序端點對＋標籤去重。
    const seenLinks = new Set<string>();
    const links = ((rec?.get("links") ?? []) as Array<{ source: string; target: string; label?: string }>)
      .filter((l) => {
        const key = [l.source, l.target].sort().join("|") + "|" + (l.label ?? "");
        if (seenLinks.has(key)) return false;
        seenLinks.add(key);
        return true;
      });
    const payload = {
      nodes: rec?.get("nodes") ?? [],
      links,
      meta: { computedAt: new Date().toISOString(), source: NEO4J_URI },
    };
    cache = { at: now, payload };
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("X-Cache", "MISS");
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "[graph-nebula] neo4j query failed");
    res.status(502).json({ nodes: [], links: [], error: "graph backend unavailable" });
  } finally {
    await session.close();
  }
});

export default router;
