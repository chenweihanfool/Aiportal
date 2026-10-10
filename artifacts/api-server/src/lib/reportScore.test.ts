import { describe, expect, it } from "vitest";
import { parseReportScore } from "./reportScore";

const BODY = `🌙 每日精煉洞察 2026-10-10

- 📝 當日總結：上午外業，下午整理管線。

- 😄 當日段子：略。

📊 今日評分：99
- 推進 3：完成兩件外業報差
- 決策 2：照計畫進行
- 卡點 3：清掉逾期的派車單
- 覺察 2：有一段工作感想
- 能量 3：提到午睡後精神好
`;

describe("parseReportScore", () => {
  it("parses five parts and recomputes the total (ignores the AI's own sum)", () => {
    const s = parseReportScore(BODY);
    expect(s?.total).toBe(65);
    expect(s?.parts.map((p) => p.value)).toEqual([3, 2, 3, 2, 3]);
    expect(s?.parts[0]).toMatchObject({ key: "progress", label: "推進", note: "完成兩件外業報差" });
  });

  it("tolerates bold, half-width colons, emoji prefixes and x/4", () => {
    const s = parseReportScore("**📊 今日評分：**\n- **🚀 推進：4/4** — 全部完成\n- 決策: 1\n- 🧹 卡點 0\n- 覺察 4 分：反思\n- 能量：2\r\n");
    expect(s?.parts.map((p) => p.value)).toEqual([4, 1, 0, 4, 2]);
    expect(s?.total).toBe(55);
  });

  it("returns null when the section or any part is missing or out of range", () => {
    expect(parseReportScore("🌙 每日精煉洞察 2026-10-10\n- ⚡ 狀態與決策：略")).toBeNull();
    expect(parseReportScore(BODY.replace("- 能量 3：提到午睡後精神好\n", ""))).toBeNull();
    expect(parseReportScore(BODY.replace("推進 3", "推進 5"))).toBeNull();
    expect(parseReportScore(null)).toBeNull();
  });

  it("does not read part labels from the report body above the 📊 heading", () => {
    const body = "⚡ 狀態與決策：推進 4 卡點 4\n\n📊 今日評分\n- 推進 1：x\n- 決策 1：x\n- 卡點 1：x\n- 覺察 1：x\n- 能量 1：x";
    expect(parseReportScore(body)?.total).toBe(25);
  });
});
