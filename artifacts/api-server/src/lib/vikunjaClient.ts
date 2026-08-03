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
}

// Tasks due within `windowDays` (including already-overdue ones), across
// every project, incomplete only. Capped and sorted soonest-due first.
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

  const now = Date.now();
  const horizon = now + windowDays * 24 * 60 * 60 * 1000;

  const upcoming: UpcomingTask[] = tasksByProject
    .flat()
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
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, maxTasks);

  return { windowDays, tasks: upcoming };
}
