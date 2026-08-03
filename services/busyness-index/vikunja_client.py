"""Minimal read-only Vikunja REST API client.

Credentials come from environment variables VIKUNJA_URL / VIKUNJA_TOKEN
unless passed explicitly (useful for tests).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import requests


@dataclass
class VikunjaProject:
    id: int
    title: str

    @classmethod
    def from_api(cls, data: dict) -> "VikunjaProject":
        return cls(id=data["id"], title=data.get("title", ""))


@dataclass
class VikunjaTask:
    id: int
    title: str
    done: bool
    project_id: int
    due_date: Optional[str]
    start_date: Optional[str]
    created: Optional[str]
    updated: Optional[str]
    done_at: Optional[str]
    priority: Optional[int]

    @classmethod
    def from_api(cls, data: dict) -> "VikunjaTask":
        return cls(
            id=data["id"],
            title=data.get("title", ""),
            done=bool(data.get("done", False)),
            project_id=data.get("project_id"),
            due_date=data.get("due_date"),
            start_date=data.get("start_date"),
            created=data.get("created"),
            updated=data.get("updated"),
            done_at=data.get("done_at"),
            priority=data.get("priority"),
        )


class VikunjaClient:
    def __init__(self, base_url: Optional[str] = None, token: Optional[str] = None, timeout: float = 10.0):
        self.base_url = (base_url or os.environ["VIKUNJA_URL"]).rstrip("/")
        self.token = token or os.environ["VIKUNJA_TOKEN"]
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({"Authorization": f"Bearer {self.token}"})

    def list_projects(self) -> list[VikunjaProject]:
        r = self._session.get(f"{self.base_url}/api/v1/projects", timeout=self.timeout)
        r.raise_for_status()
        return [VikunjaProject.from_api(p) for p in r.json()]

    def list_tasks_in_project(self, project_id: int, per_page: int = 50) -> list[VikunjaTask]:
        tasks: list[VikunjaTask] = []
        page = 1
        while True:
            r = self._session.get(
                f"{self.base_url}/api/v1/projects/{project_id}/tasks",
                params={"page": page, "per_page": per_page},
                timeout=self.timeout,
            )
            r.raise_for_status()
            batch = r.json()
            if not batch:
                break
            tasks.extend(VikunjaTask.from_api(t) for t in batch)
            if len(batch) < per_page:
                break
            page += 1
        return tasks

    def list_all_tasks(self) -> list[VikunjaTask]:
        tasks: list[VikunjaTask] = []
        for project in self.list_projects():
            tasks.extend(self.list_tasks_in_project(project.id))
        return tasks
