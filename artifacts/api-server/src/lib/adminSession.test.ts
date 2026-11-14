// isAuthorized()：2026-11-14 起只認原始 ADMIN_PASSWORD 與 Google 登入閘的內部 bridge token，
// 不再接受瀏覽器 session token。adminPassword 在模組載入時讀環境變數，所以先設好再動態 import。
import { describe, expect, it } from "vitest";

process.env["ADMIN_PASSWORD"] = "admin-session-test-pwd";

describe("isAuthorized", () => {
  it("接受原始 ADMIN_PASSWORD 與登入閘的 bridge token", async () => {
    const { isAuthorized, GOOGLE_BRIDGE_TOKEN } = await import("./adminSession");
    const { ADMIN_PASSWORD } = await import("./adminPassword");
    expect(isAuthorized(ADMIN_PASSWORD)).toBe(true);
    expect(isAuthorized(GOOGLE_BRIDGE_TOKEN)).toBe(true);
  });

  it("拒絕隨機字串、空字串與 undefined", async () => {
    const { isAuthorized } = await import("./adminSession");
    expect(isAuthorized("some-random-token")).toBe(false);
    expect(isAuthorized("")).toBe(false);
    expect(isAuthorized(undefined)).toBe(false);
  });
});
