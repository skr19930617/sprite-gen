import { useEffect, useState } from "react";
import { api, type ProjectSummary } from "../lib/api";
import type { NavigateFn } from "../app/screens";

export function ProjectLibraryScreen(props: { onNavigate: NavigateFn }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listProjects()
      .then((res) => {
        if (!cancelled) setProjects(res.projects);
      })
      .catch((err) => {
        if (!cancelled) setError(`Failed to load projects (status=${err.status ?? "?"})`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section data-testid="library-screen">
      <h2>Project library</h2>
      <button onClick={() => props.onNavigate({ name: "input" })}>+ New project</button>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {projects === null && !error && <p>Loading…</p>}
      {projects && projects.length === 0 && <p>No projects yet.</p>}
      {projects && projects.length > 0 && (
        <ul>
          {projects.map((p) => (
            <li key={p.project_id}>
              <button onClick={() => props.onNavigate({ name: "result", projectId: p.project_id })}>
                {p.project_id} ({p.animation_summaries.length} animations)
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
