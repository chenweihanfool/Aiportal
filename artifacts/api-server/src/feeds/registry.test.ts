import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEED_NAME, FEED_REGISTRY } from "./registry";

// 推送端用的 JSON 檔：<repo>/schemas/feeds/<name>.v<version>.schema.json，必須與登記表一致。
// 改了登記表：UPDATE_SCHEMAS=1 pnpm --filter @workspace/api-server test 重新輸出。
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../schemas/feeds");

describe("feed registry", () => {
  it("名稱合法、版本是正整數、schema 是物件", () => {
    for (const [name, def] of Object.entries(FEED_REGISTRY)) {
      expect(FEED_NAME.test(name), name).toBe(true);
      expect(Number.isInteger(def.version) && def.version >= 1, name).toBe(true);
      expect(typeof def.schema).toBe("object");
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("schemas/feeds/ 的 JSON 檔與登記表一致（不漂移）", () => {
    if (process.env["UPDATE_SCHEMAS"] === "1") mkdirSync(dir, { recursive: true });
    for (const [name, def] of Object.entries(FEED_REGISTRY)) {
      const file = path.join(dir, `${name}.v${def.version}.schema.json`);
      const want = JSON.stringify(def.schema, null, 2) + "\n";
      if (process.env["UPDATE_SCHEMAS"] === "1") writeFileSync(file, want);
      expect(existsSync(file), `缺 ${file}（跑 UPDATE_SCHEMAS=1 重新輸出）`).toBe(true);
      expect(readFileSync(file, "utf8"), file).toBe(want);
    }
  });
});
