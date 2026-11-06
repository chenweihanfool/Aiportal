import { Router, type Request, type Response } from "express";
import { db, hermesDocTable, hermesGraphSnapshotTable } from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { isAuthorized } from "../lib/adminSession";
import { buildContexts, isDocKind, validateDocs } from "../lib/hermesDoc";
import { escapeLike, makeSnippet, validateSearchParams } from "../lib/hermesDocSearch";

const router = Router();

// 內容層：事件正文、概念／方法的出現脈絡。資料由 HERMES 的 hermes-graph-pusher.py 以 content_hash 增量
// upsert 進來；前端在關係宇宙的詳情面板「內容」分頁讀取。設計：kb-pipeline docs/portal-content-design.md。
// 內容含個人日記衍生資料 → GET／POST 都走跟 hermes-graph 一樣的 admin-password 私領域閘。

router.post("/admin/hermes-doc", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要管理員權限" });
  }
  const parsed = validateDocs(req.body);
  if (!parsed.ok) return res.status(400).json({ message: parsed.error });

  await db
    .insert(hermesDocTable)
    .values(parsed.docs.map((d) => ({
      kind: d.kind, docKey: d.key, title: d.title, bodyMd: d.bodyMd, truncated: d.truncated,
      meta: d.meta, sourcePath: d.sourcePath, contentHash: d.contentHash,
    })))
    .onConflictDoUpdate({
      target: [hermesDocTable.kind, hermesDocTable.docKey],
      set: {
        title: sql`excluded.title`,
        bodyMd: sql`excluded.body_md`,
        truncated: sql`excluded.truncated`,
        meta: sql`excluded.meta`,
        sourcePath: sql`excluded.source_path`,
        contentHash: sql`excluded.content_hash`,
        updatedAt: new Date(),
      },
    });
  return res.json({ success: true, upserted: parsed.docs.length });
});

// 單筆：事件回正文＋來源；概念／方法回 hub 本文＋「出現脈絡」（每個引用它的事件的標題與正文摘錄，新→舊）。
// 查無＝尚未同步（前端顯示「內容尚未同步」，不是錯誤）。
router.get("/hermes-doc/:kind/:key", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const kind = String(req.params["kind"]);
  const key = String(req.params["key"] ?? "");
  if (!isDocKind(kind) || !key) return res.status(400).json({ message: "kind／key 不合法" });

  const [row] = await db
    .select()
    .from(hermesDocTable)
    .where(and(eq(hermesDocTable.kind, kind), eq(hermesDocTable.docKey, key)))
    .limit(1);
  if (!row) return res.status(404).json({ message: "內容尚未同步" });

  const base = {
    kind, key, title: row.title, bodyMd: row.bodyMd, truncated: row.truncated, updatedAt: row.updatedAt.toISOString(),
  };

  // 來源原文與主題引文索引：原樣回 meta（type／case／date／rawPath／quotes…）與 sourcePath，不組脈絡。
  if (kind === "source" || kind === "topic") {
    return res.json({ ...base, meta: row.meta, sourcePath: row.sourcePath });
  }

  if (kind === "event") {
    const meta = row.meta as { date?: unknown; sources?: unknown };
    return res.json({
      ...base,
      date: typeof meta.date === "string" ? meta.date : null,
      sources: Array.isArray(meta.sources) ? meta.sources : [],
    });
  }

  const meta = row.meta as { refs?: unknown; promoted?: unknown; aliases?: unknown };
  const refIds = Array.isArray(meta.refs)
    ? (meta.refs as Array<{ eventId?: unknown }>).map((r) => r?.eventId).filter((v): v is string => typeof v === "string")
    : [];
  const ids = Array.from(new Set(refIds));

  const [bodies, snap] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([] as Array<{ key: string; head: string }>)
      : db
          .select({ key: hermesDocTable.docKey, head: sql<string>`substring(${hermesDocTable.bodyMd} from 1 for 600)` })
          .from(hermesDocTable)
          .where(and(eq(hermesDocTable.kind, "event"), inArray(hermesDocTable.docKey, ids))),
    db
      .select({ events: hermesGraphSnapshotTable.events })
      .from(hermesGraphSnapshotTable)
      .where(eq(hermesGraphSnapshotTable.id, "latest"))
      .limit(1),
  ]);
  const wanted = new Set(ids);
  const eventById = new Map(
    (snap[0]?.events ?? []).filter((e) => wanted.has(e.id)).map((e) => [e.id, { title: e.title, date: e.date }] as const),
  );
  const bodyHeadById = new Map(bodies.map((b) => [b.key, b.head] as const));

  return res.json({
    ...base,
    promoted: meta.promoted === true,
    aliases: Array.isArray(meta.aliases) ? meta.aliases.filter((a): a is string => typeof a === "string") : [],
    contexts: buildContexts(meta.refs, eventById, bodyHeadById),
  });
});

// 原文全文搜尋：只搜 kind='source' 的 title 與 body_md，不分大小寫的子字串比對（ILIKE，% _ \ 已跳脫）。
// 依 meta.date 新到舊，null 排最後。snippet 與 hitAt 在 JS 端由 makeSnippet 算。
router.get("/hermes-doc-search", async (req: Request, res: Response) => {
  if (!isAuthorized(req.headers["x-admin-password"])) {
    return res.status(403).json({ message: "需要解鎖私領域才能查看" });
  }
  const v = validateSearchParams(req.query["q"], req.query["limit"]);
  if (!v.ok) return res.status(400).json({ message: v.message });

  const pattern = `%${escapeLike(v.q)}%`;
  const rows = await db
    .select({ key: hermesDocTable.docKey, title: hermesDocTable.title, bodyMd: hermesDocTable.bodyMd, meta: hermesDocTable.meta })
    .from(hermesDocTable)
    .where(and(
      eq(hermesDocTable.kind, "source"),
      or(sql`${hermesDocTable.title} ILIKE ${pattern}`, sql`${hermesDocTable.bodyMd} ILIKE ${pattern}`),
    ))
    .orderBy(sql`(${hermesDocTable.meta}->>'date') DESC NULLS LAST`)
    .limit(v.limit);

  return res.json({
    results: rows.map((r) => {
      const { snippet, hitAt } = makeSnippet(r.bodyMd, v.q);
      return { key: r.key, title: r.title, meta: r.meta, snippet, hitAt };
    }),
  });
});

export default router;
