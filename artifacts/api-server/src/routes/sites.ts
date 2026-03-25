import { Router, type Request, type Response, type NextFunction } from "express";
import { db, portalSitesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router = Router();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "85097110";

interface SiteLink {
  label: string;
  url: string;
}

interface ApiSite {
  id: string;
  name: string;
  subtitle: string;
  links: SiteLink[];
  worldXZ: [number, number];
  isPrivate: boolean;
}

const DEFAULT_SITES: Omit<ApiSite, "id">[] = [
  {
    name: "人生進度管理系統",
    subtitle: "Life Progress Management",
    links: [
      { label: "進入系統", url: "https://pf-cwh.replit.app/" },
      { label: "再平衡計算器", url: "https://pf-cwh.replit.app/rebalancer" },
    ],
    worldXZ: [4.0, 1.5],
    isPrivate: true,
  },
  {
    name: "健身追蹤",
    subtitle: "Fitness Tracking",
    links: [{ label: "進入系統", url: "https://fitness-forge-chenweihanfool.replit.app/" }],
    worldXZ: [5.5, 3.5],
    isPrivate: true,
  },
  {
    name: "扭曲的夢境",
    subtitle: "Twisted Dreams — Art",
    links: [{ label: "進入系統", url: "https://art-mart--chenweihanfool.replit.app/" }],
    worldXZ: [3.5, -1.0],
    isPrivate: true,
  },
  {
    name: "圖根點管理系統",
    subtitle: "Survey Control Points",
    links: [{ label: "進入系統", url: "https://kc2-cwh.replit.app/" }],
    worldXZ: [-3.0, -1.5],
    isPrivate: false,
  },
  {
    name: "土地移轉分析系統",
    subtitle: "Land Transfer Analysis",
    links: [{ label: "進入系統", url: "https://land-transfer-visualizer.replit.app/" }],
    worldXZ: [-5.0, 1.0],
    isPrivate: false,
  },
  {
    name: "案件排程系統",
    subtitle: "Case Scheduling",
    links: [{ label: "進入系統", url: "https://map-scheduler.replit.app/" }],
    worldXZ: [-3.5, 3.5],
    isPrivate: false,
  },
];

function toApiSite(row: typeof portalSitesTable.$inferSelect): ApiSite {
  return {
    id: String(row.id),
    name: row.name,
    subtitle: row.subtitle,
    links: (row.links ?? []) as SiteLink[],
    worldXZ: [row.worldX, row.worldZ],
    isPrivate: row.isPrivate,
  };
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const pw = req.headers["x-admin-password"] as string | undefined;
  if (pw !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.post("/auth/verify", (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: "Wrong password" });
  }
});

router.get("/sites", async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(portalSitesTable)
    .orderBy(asc(portalSitesTable.sortOrder), asc(portalSitesTable.id));

  if (rows.length === 0) {
    const insertValues = DEFAULT_SITES.map((s, i) => ({
      name: s.name,
      subtitle: s.subtitle,
      links: s.links,
      worldX: s.worldXZ[0],
      worldZ: s.worldXZ[1],
      isPrivate: s.isPrivate,
      sortOrder: i,
    }));
    await db.insert(portalSitesTable).values(insertValues);
    const seeded = await db
      .select()
      .from(portalSitesTable)
      .orderBy(asc(portalSitesTable.sortOrder), asc(portalSitesTable.id));
    res.json({ sites: seeded.map(toApiSite) });
    return;
  }

  res.json({ sites: rows.map(toApiSite) });
});

router.post("/sites", requireAdmin, async (req: Request, res: Response) => {
  const { name, subtitle, links, worldXZ, isPrivate } = req.body as {
    name: string;
    subtitle?: string;
    links: SiteLink[];
    worldXZ: [number, number];
    isPrivate: boolean;
  };

  const [inserted] = await db
    .insert(portalSitesTable)
    .values({
      name: name.trim(),
      subtitle: (subtitle ?? "").trim(),
      links,
      worldX: worldXZ[0],
      worldZ: worldXZ[1],
      isPrivate,
      sortOrder: 999,
    })
    .returning();

  res.status(201).json({ site: toApiSite(inserted) });
});

router.put("/sites/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { name, subtitle, links, worldXZ, isPrivate } = req.body as {
    name?: string;
    subtitle?: string;
    links?: SiteLink[];
    worldXZ?: [number, number];
    isPrivate?: boolean;
  };

  const updates: Partial<typeof portalSitesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name.trim();
  if (subtitle !== undefined) updates.subtitle = subtitle.trim();
  if (links !== undefined) updates.links = links;
  if (worldXZ !== undefined) { updates.worldX = worldXZ[0]; updates.worldZ = worldXZ[1]; }
  if (isPrivate !== undefined) updates.isPrivate = isPrivate;

  const [updated] = await db
    .update(portalSitesTable)
    .set(updates)
    .where(eq(portalSitesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json({ site: toApiSite(updated) });
});

router.delete("/sites/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  await db.delete(portalSitesTable).where(eq(portalSitesTable.id, id));
  res.json({ ok: true });
});

export default router;
