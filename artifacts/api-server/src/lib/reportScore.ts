// 每日報告分數：解析日報（每日洞察 66c1cab358f3）最後的 📊 評分段。
// 格式（prompt 固定）：
//   📊 今日評分：65
//   - 推進 3：完成兩件外業報差
//   - 決策 2：照計畫進行
//   - 卡點 3：…  - 覺察 2：…  - 能量 3：…
// 五項各 0–4，總分＝五項加總×5（0–100）。總分一律由五項重算，不採用 AI 自己寫的加總；
// 五項缺任何一項就視為沒有分數（null），不猜。

export const REPORT_SCORE_PARTS = [
  { key: "progress", label: "推進" },
  { key: "decision", label: "決策" },
  { key: "blocker", label: "卡點" },
  { key: "awareness", label: "覺察" },
  { key: "energy", label: "能量" },
] as const;

export interface ReportScorePart { key: string; label: string; value: number; note: string }
export interface ReportScore { total: number; parts: ReportScorePart[] }

const HEAD_RE = /📊\s*\**\s*今日評分/;

export function parseReportScore(bodyMd: string | null | undefined): ReportScore | null {
  if (!bodyMd) return null;
  const lines = bodyMd.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => HEAD_RE.test(l));
  if (start < 0) return null;
  const block = lines.slice(start + 1, start + 12).map((l) => l.replace(/\*\*/g, "").trim());
  const parts: ReportScorePart[] = [];
  for (const { key, label } of REPORT_SCORE_PARTS) {
    const re = new RegExp(`^[-*•]?\\s*(?:\\S{1,2}\\s*)?${label}\\s*[:：]?\\s*([0-4])(?:\\s*/\\s*4)?\\s*分?\\s*[:：｜|—-]?\\s*(.*)$`);
    const m = block.map((l) => re.exec(l)).find((x) => x);
    if (!m) return null;
    parts.push({ key, label, value: Number(m[1]), note: (m[2] ?? "").trim().slice(0, 40) });
  }
  return { total: parts.reduce((s, p) => s + p.value, 0) * 5, parts };
}
