import { fetchVikunjaSummary } from "./vikunjaClient";

export interface SummarySource {
  id: string;
  name: string;
  isPrivate: boolean;
  // Returns the JSON payload to cache as-is. Most sources are a plain
  // `/api/public/summary` GET; Vikunja is a third-party app we don't
  // control the source of, so it calls Vikunja's own API directly instead.
  fetch: () => Promise<unknown>;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Add one entry per subsystem as it comes online. summaryFetchJob polls
// every source on the same schedule and caches the result in
// subsystem_summaries.
export const SUMMARY_SOURCES: SummarySource[] = [
  {
    id: "pf-cwh",
    name: "人生進度管理系統",
    isPrivate: true,
    fetch: () =>
      fetchJson(process.env["PF_CWH_SUMMARY_URL"] ?? "https://cwh2023.synology.me/pf/api/public/summary"),
  },
  {
    id: "fitnessforge",
    name: "運動 APP 系統",
    isPrivate: true,
    fetch: () =>
      fetchJson(process.env["FITNESSFORGE_SUMMARY_URL"] ?? "https://cwh2023.synology.me/fitness/api/public/summary"),
  },
  {
    id: "vikunja",
    name: "任務追蹤系統",
    isPrivate: true,
    fetch: () => {
      const baseUrl = process.env["VIKUNJA_API_BASE_URL"];
      const token = process.env["VIKUNJA_API_TOKEN"];
      if (!baseUrl || !token) {
        throw new Error("VIKUNJA_API_BASE_URL / VIKUNJA_API_TOKEN not configured");
      }
      return fetchVikunjaSummary(baseUrl.replace(/\/$/, ""), token);
    },
  },
];
