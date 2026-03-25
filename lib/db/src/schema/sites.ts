import { pgTable, text, serial, boolean, real, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const portalSitesTable = pgTable("portal_sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  links: jsonb("links").notNull().$type<Array<{ label: string; url: string }>>(),
  worldX: real("world_x").notNull(),
  worldZ: real("world_z").notNull(),
  isPrivate: boolean("is_private").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertPortalSiteSchema = createInsertSchema(portalSitesTable).omit({ id: true });
export type InsertPortalSite = z.infer<typeof insertPortalSiteSchema>;
export type PortalSite = typeof portalSitesTable.$inferSelect;
