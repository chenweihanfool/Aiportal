// Minimal, read-only wrapper around Vikunja's REST API (v1). Vikunja is a
// third-party app (not something we control the source of), so unlike
// pf-cwh/FitnessForge there's no "add a /api/public/summary route" option —
// Aiportal has to call Vikunja's own API directly with a dedicated token.

export interface VikunjaProject {
  id: number;
  title: string;
}

export interface VikunjaTask {
  id: number;
  title: string;
  done: boolean;
  due_date: string;
  start_date: string;
  project_id: number;
}

// Vikunja (Go zero-value time) represents "no date set" as year 1, e.g.
// "0001-01-01T00:00:00Z" — see tasktracker/README.md's gantt-sorting notes.
function isUnsetDate(iso: string | undefined): boolean {
  return !iso || iso.startsWith("0001-");
}

export class VikunjaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Vikunja API ${path} -> HTTP ${res.status}`);
    return res.json() as Promise<T>;
  }

  listProjects(): Promise<VikunjaProject[]> {
    return this.request<VikunjaProject[]>("/api/v1/projects");
  }

  async listTasksInProject(projectId: number): Promise<VikunjaTask[]> {
    const all: VikunjaTask[] = [];
    for (let page = 1; ; page++) {
      const pageTasks = await this.request<VikunjaTask[]>(
        `/api/v1/projects/${projectId}/tasks?page=${page}&per_page=50`,
      );
      if (!pageTasks || pageTasks.length === 0) break;
      all.push(...pageTasks);
      if (pageTasks.length < 50) break;
    }
    return all;
  }
}

export interface UpcomingTask {
  id: number;
  title: string;
  projectId: number;
  projectTitle: string;
  dueDate: string;
  startDate: string | null;
  overdue: boolean;
}

export interface VikunjaSummary {
  windowDays: number;
  tasks: UpcomingTask[];
  totalTasks: number;
  doneTasks: number;
  completionRate: number | null;
  upcomingCount: number;
  overdueCount: number;
  busyIndex: number | null;
}

// Tasks due within `windowDays` (including already-overdue ones), across
// every project, incomplete only. `tasks` is capped for display; the counts
// below are computed from the FULL fetched set, not the capped list.
export async function fetchVikunjaSummary(
  baseUrl: string,
  token: string,
  windowDays = 7,
  maxTasks = 8,
): Promise<VikunjaSummary> {
  const client = new VikunjaClient(baseUrl, token);
  const projects = await client.listProjects();
  const projectTitleById = new Map(projects.map((p) => [p.id, p.title]));

  const tasksByProject = await Promise.all(
    projects.map((p) => client.listTasksInProject(p.id)),
  );
  const allTasks = tasksByProject.flat();

  const totalTasks = allTasks.length;
  const doneTasks = allTasks.filter((t) => t.done).length;
  const completionRate = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : null;

  const now = Date.now();
  const horizon = now + windowDays * 24 * 60 * 60 * 1000;

  const upcomingAll: UpcomingTask[] = allTasks
    .filter((t) => !t.done && !isUnsetDate(t.due_date))
    .map((t) => ({
      id: t.id,
      title: t.title,
      projectId: t.project_id,
      projectTitle: projectTitleById.get(t.project_id) ?? "",
      dueDate: t.due_date,
      startDate: isUnsetDate(t.start_date) ? null : t.start_date,
      overdue: new Date(t.due_date).getTime() < now,
    }))
    .filter((t) => new Date(t.dueDate).getTime() <= horizon)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const overdueCount = upcomingAll.filter((t) => t.overdue).length;
  const upcomingCount = upcomingAll.length - overdueCount;

  // 忙碌指數：逾期任務、待辦任務量、完成率三項加權，逾期權重最高（最直接的
  // 壓力訊號），完成率用「落後程度」（100-completionRate）而非直接用完成率，
  // 分數越高代表越忙／壓力越大，封頂 100。這是第一版粗略公式，數字本身沒有
  // 精確的科學意義，用來抓「大概是不是在超載」的相對趨勢。
  const behindRate = completionRate !== null ? 100 - completionRate : 50;
  const busyIndex = Math.min(100, Math.round(overdueCount * 15 + upcomingCount * 5 + behindRate * 0.3));

  return {
    windowDays,
    tasks: upcomingAll.slice(0, maxTasks),
    totalTasks,
    doneTasks,
    completionRate,
    upcomingCount,
    overdueCount,
    busyIndex,
  };
}
