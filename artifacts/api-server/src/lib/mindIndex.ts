// Reads HERMES's daily-computed 心智指標 (knowledge-base vitality score) from
// a file on the NAS — HERMES's own scoring script writes this, Aiportal only
// reads it. Parsed with regex rather than a YAML parser: the frontmatter
// here is flat key: value lines, a real parser would be more code for no
// benefit, and regex extraction fails safely (missing field -> null)
// instead of throwing on a shape we didn't anticipate.
import { readFile } from "node:fs/promises";

const MIND_INDEX_PATH = process.env["MIND_INDEX_PATH"] ?? "/mnt/knowledge/心智指標.md";
const MIND_INDEX_HISTORY_PATH =
  process.env["MIND_INDEX_HISTORY_PATH"] ?? "/mnt/knowledge/心智指標-history.jsonl";

// "Stale" here means HERMES's own scoring script hasn't run recently — a
// different concept from Aiportal's own fetchedAt (always "just now", since
// this is a live per-page-load read of whatever the file currently
// contains). A successfully-read file can still hold a stale score.
const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000;

export interface MindIndexData {
  score: number | null;
  conversion: number | null;
  linkHealth: number | null;
  vitality: number | null;
  rhythm: number | null;
  rhythmTrendPct: number | null;
  partial: boolean;
  updatedAt: string | null;
  stale: boolean;
  history: Array<{ date: string; score: number }>;
}

function extractNumber(frontmatter: string, key: string): number | null {
  const m = frontmatter.match(new RegExp(`${key}:\\s*([\\d.]+)`));
  return m ? Number(m[1]) : null;
}

// HERMES writes `updated: "YYYY-MM-DD HH:mm"` — no seconds, no timezone.
// Confirmed against a real sample (2026-08-09): the raw string is bare
// Taipei local time, matching every other timestamp convention in this
// system (services/busyness-index, FitnessForge's getTaipeiComponents,
// etc.). Must NOT hand that string to `new Date()` directly — environments
// differ on how a bare "YYYY-MM-DD HH:mm" gets interpreted (as local time
// in whatever timezone the container happens to run in, not necessarily
// Taipei), which would silently shift the staleness check by hours.
// Explicitly attaching +08:00 makes this unambiguous regardless of the
// container's own timezone setting.
function parseTaipeiTimestamp(raw: string): Date | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function fetchMindIndex(): Promise<MindIndexData> {
  const text = await readFile(MIND_INDEX_PATH, "utf-8");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? text;

  const score = extractNumber(frontmatter, "score");
  const conversion = extractNumber(frontmatter, "conversion");
  const linkHealth = extractNumber(frontmatter, "link_health");
  const vitality = extractNumber(frontmatter, "vitality");
  const rhythm = extractNumber(frontmatter, "rhythm");
  const rhythmTrendPct = extractNumber(frontmatter, "rhythm_trend_pct");

  const updatedMatch = frontmatter.match(/updated:\s*"([^"]+)"/);
  const updatedDate = updatedMatch ? parseTaipeiTimestamp(updatedMatch[1]) : null;
  const updatedAt = updatedDate ? updatedDate.toISOString() : null;
  const stale = updatedDate === null || Date.now() - updatedDate.getTime() > STALE_THRESHOLD_MS;

  const partialMatch = frontmatter.match(/partial:\s*(true|false)/);
  const partial = partialMatch
    ? partialMatch[1] === "true"
    : [conversion, linkHealth, vitality, rhythm].some((v) => v === null);

  const history = await fetchMindIndexHistory();

  return { score, conversion, linkHealth, vitality, rhythm, rhythmTrendPct, partial, updatedAt, stale, history };
}

// The history file is optional (the user described it as an alternative
// data source, not guaranteed to exist) — its absence isn't an error, it
// just means no trend chart yet, same as a brand-new happiness_index_history.
async function fetchMindIndexHistory(): Promise<Array<{ date: string; score: number }>> {
  let text: string;
  try {
    text = await readFile(MIND_INDEX_HISTORY_PATH, "utf-8");
  } catch {
    return [];
  }

  const points: Array<{ date: string; score: number }> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      const date =
        typeof row["date"] === "string"
          ? row["date"]
          : typeof row["updated"] === "string"
            ? row["updated"].slice(0, 10)
            : null;
      const score = typeof row["score"] === "number" ? row["score"] : null;
      if (date && score !== null) points.push({ date, score });
    } catch {
      // Skip a malformed line rather than fail the whole read over one bad entry.
    }
  }
  return points;
}
