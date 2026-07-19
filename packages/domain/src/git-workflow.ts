export interface CommitChangeSummary {
  additions: number;
  deletions: number;
  path: string;
  status: string;
}

export interface SuggestedCommit {
  message: string;
  summary: string;
}

const scopeLabels: Record<string, string> = {
  api: "API",
  contracts: "contracts",
  desktop: "desktop Git workflow",
  docs: "documentation",
  domain: "domain rules",
  integrations: "integrations",
  packages: "shared packages",
  tests: "tests",
  web: "board interface",
};

function pathScope(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "apps" && parts[1] !== undefined) return parts[1];
  if (parts[0] === "packages" && parts[1] !== undefined) return parts[1];
  return parts[0] ?? "project";
}

function changeVerb(changes: CommitChangeSummary[]): string {
  const statuses = new Set(changes.map((change) => change.status.toLowerCase()));
  if ([...statuses].every((status) => status === "a" || status === "added" || status === "untracked")) return "Add";
  if ([...statuses].every((status) => status === "d" || status === "deleted")) return "Remove";
  if ([...statuses].some((status) => status === "r" || status === "renamed")) return "Refine";
  return "Update";
}

export function suggestCommit(changes: CommitChangeSummary[]): SuggestedCommit {
  if (changes.length === 0) return { message: "", summary: "No files assigned to this commit." };

  const scopes = [...new Set(changes.map((change) => pathScope(change.path)))];
  const namedScopes = scopes.slice(0, 2).map((scope) => scopeLabels[scope] ?? scope);
  const scope = namedScopes.join(" and ") + (scopes.length > 2 ? " workflow" : "");
  const additions = changes.reduce((total, change) => total + change.additions, 0);
  const deletions = changes.reduce((total, change) => total + change.deletions, 0);
  const message = `${changeVerb(changes)} ${scope}`.slice(0, 72);
  const fileLabel = `${changes.length} ${changes.length === 1 ? "file" : "files"}`;

  return {
    message,
    summary: `${fileLabel} · +${additions} / -${deletions} across ${scopes.join(", ")}`,
  };
}
