import { describe, expect, it } from "vitest";
import { cleanMessage, idleMinutesOf, isRestartMode, isSafeId, needsNewSession, restartBlockReason, sessionTitle, transcriptOf, upstreamMessage } from "./hermesChat";

const NOW = new Date("2026-10-30T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

describe("needsNewSession", () => {
  it("閒置滿 60 分鐘才開新的；聊到一半不切", () => {
    expect(needsNewSession(ago(59), NOW, 60)).toBe(false);
    expect(needsNewSession(ago(60), NOW, 60)).toBe(true);
  });
  it("還沒有 session 就開新的", () => {
    expect(needsNewSession(null, NOW, 60)).toBe(true);
  });
});

describe("idleMinutesOf", () => {
  it("設定值壞掉就用 60", () => {
    expect(idleMinutesOf("30")).toBe(30);
    for (const v of [undefined, "", "abc", "0", "-5", "1.5"]) expect(idleMinutesOf(v)).toBe(60);
  });
});

describe("restartBlockReason", () => {
  const last = (status: string, mode = "graceful", min = 1) => ({ mode, status, requestedAt: ago(min) });
  it("沒紀錄可以重啟", () => {
    expect(restartBlockReason(null, "graceful", NOW)).toBeNull();
  });
  it("進行中不能再按", () => {
    expect(restartBlockReason(last("running"), "graceful", NOW)).toContain("還在進行");
    expect(restartBlockReason(last("pending", "force"), "force", NOW)).toContain("還在進行");
  });
  it("優雅重啟卡住時可以用強制蓋過", () => {
    expect(restartBlockReason(last("running"), "force", NOW)).toBeNull();
  });
  it("成功後 5 分鐘內擋住；失敗或逾時可以馬上再試", () => {
    expect(restartBlockReason(last("done"), "graceful", NOW)).toContain("5 分鐘");
    expect(restartBlockReason(last("done", "graceful", 6), "graceful", NOW)).toBeNull();
    expect(restartBlockReason(last("timeout"), "force", NOW)).toBeNull();
    expect(restartBlockReason(last("failed"), "graceful", NOW)).toBeNull();
  });
});

describe("輸入檢查", () => {
  it("cleanMessage：去空白、擋空字串與過長", () => {
    expect(cleanMessage("  hi ")).toBe("hi");
    expect(cleanMessage("   ")).toBeNull();
    expect(cleanMessage("x".repeat(8001))).toBeNull();
    expect(cleanMessage(1)).toBeNull();
  });
  it("isSafeId：擋路徑字元", () => {
    expect(isSafeId("run_abc-123")).toBe(true);
    expect(isSafeId("../etc")).toBe(false);
    expect(isSafeId("a/b")).toBe(false);
    expect(isSafeId(null)).toBe(false);
  });
  it("isRestartMode 只收兩種", () => {
    expect(isRestartMode("force")).toBe(true);
    expect(isRestartMode("reboot")).toBe(false);
  });
});

describe("transcriptOf", () => {
  it("只留有文字的使用者與助手訊息，由舊到新", () => {
    const r = transcriptOf({ data: [
      { id: 3, role: "assistant", content: "ok", timestamp: 3, tool_name: null },
      { id: 2, role: "tool", content: "x", timestamp: 2 },
      { id: 4, role: "assistant", content: "", timestamp: 4 },
      { id: 1, role: "user", content: "hi", timestamp: 1 },
    ] });
    expect(r.map((m) => m.id)).toEqual([1, 3]);
  });
  it("格式不對回空", () => {
    expect(transcriptOf(null)).toEqual([]);
    expect(transcriptOf({ data: "x" })).toEqual([]);
  });
});

describe("sessionTitle", () => {
  it("每次都不同（HERMES 標題不能重複），用台北時間", () => {
    expect(sessionTitle(new Date("2026-10-30T14:40:05Z"))).toBe("入口網對話 2026-10-30 22:40:05");
    expect(sessionTitle(new Date("2026-10-30T14:40:06Z"))).not.toBe(sessionTitle(new Date("2026-10-30T14:40:05Z")));
  });
});

describe("upstreamMessage", () => {
  it("帶出 HERMES 的錯誤原文；不是 JSON 就只寫狀態碼", () => {
    expect(upstreamMessage(400, JSON.stringify({ error: { message: "Title already in use" } }))).toBe("HERMES 回 400：Title already in use");
    expect(upstreamMessage(500, "oops")).toBe("HERMES 回 500");
  });
});
