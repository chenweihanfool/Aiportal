export interface SummarySource {
  id: string;
  name: string;
  url: string;
  isPrivate: boolean;
  timeoutMs?: number;
}

// Add one entry per subsystem as its /api/public/summary (or equivalent)
// endpoint comes online. summaryFetchJob polls every source on the same
// schedule and caches the result in subsystem_summaries.
export const SUMMARY_SOURCES: SummarySource[] = [
  {
    id: "pf-cwh",
    name: "人生進度管理系統",
    url: process.env["PF_CWH_SUMMARY_URL"] ?? "https://cwh2023.synology.me/pf/api/public/summary",
    isPrivate: true,
  },
  {
    id: "fitnessforge",
    name: "運動 APP 系統",
    url: process.env["FITNESSFORGE_SUMMARY_URL"] ?? "https://cwh2023.synology.me/fitness/api/public/summary",
    isPrivate: true,
  },
];
