import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useProject, useQuietThreadShell } from "./entities";
import { useSelectedThreadWorktreePath, useThreadWorktreePath } from "./use-thread-detail";
import { useThreadSelection } from "./use-thread-selection";
import { resolvePreferredThreadWorktreePath } from "../features/terminal/terminalLaunchContext";

export function useSelectedThreadWorktree() {
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  const detailWorktreePath = useSelectedThreadWorktreePath();

  const selectedThreadWorktreePath = useMemo(
    () =>
      resolvePreferredThreadWorktreePath({
        threadShellWorktreePath: selectedThread?.worktreePath ?? null,
        threadDetailWorktreePath: detailWorktreePath,
      }),
    [detailWorktreePath, selectedThread?.worktreePath],
  );

  return {
    selectedThreadWorktreePath,
    selectedThreadCwd: selectedThreadWorktreePath ?? selectedThreadProject?.workspaceRoot ?? null,
  };
}

/** The selected-thread cwd resolution for a thread that is not the current route's. */
export function useThreadCwd(ref: ScopedThreadRef | null): string | null {
  const shell = useQuietThreadShell(ref);
  const detailWorktreePath = useThreadWorktreePath(ref);
  const project = useProject(
    shell === null ? null : { environmentId: shell.environmentId, projectId: shell.projectId },
  );
  return (
    resolvePreferredThreadWorktreePath({
      threadShellWorktreePath: shell?.worktreePath ?? null,
      threadDetailWorktreePath: detailWorktreePath,
    }) ??
    project?.workspaceRoot ??
    null
  );
}
