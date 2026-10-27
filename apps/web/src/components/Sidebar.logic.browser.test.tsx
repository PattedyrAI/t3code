import { describe, expect, it, vi } from "vite-plus/test";

import { act, fakeTimers, render } from "../../test/render";
import { useSnoozeWakeClock, useThreadJumpHintsVisible } from "./Sidebar.logic";
import { partitionSidebarThreads } from "./Sidebar";
import { makeThreadFixture } from "../test-fixtures";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ScheduledTaskId,
  ThreadId,
  type ScheduledTask,
} from "@t3tools/contracts";

function scheduleFor(threadId: ThreadId, nextRunAt: string | null): ScheduledTask {
  return {
    id: ScheduledTaskId.make(`task:${threadId}`),
    threadId,
    nextRunAt,
    title: "Review",
    prompt: "Review",
    enabled: true,
    schedule: { type: "interval", everyMs: 7_200_000 },
    projectId: ProjectId.make("project-test"),
    workspaceStrategy: { type: "root" },
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    createdAt: "2026-10-27T08:00:00Z",
    updatedAt: "2026-10-27T08:00:00Z",
    lastRunAt: null,
    lastRunStatus: "never",
    lastRunError: null,
    runCount: 0,
  };
}

it("partitions Scheduled sessions in next-run order with stable ids and unknown due times last", () => {
  const environmentId = EnvironmentId.make("scheduled-environment");
  const threads = ["unknown", "late", "b", "a"].map((id) =>
    makeThreadFixture({ id: ThreadId.make(id), environmentId, runtime: null }),
  );
  const partition = partitionSidebarThreads({
    threads,
    schedules: new Map(
      threads.map((thread) => [
        `${environmentId}:${thread.id}`,
        [
          scheduleFor(
            thread.id,
            thread.id === "unknown"
              ? null
              : thread.id === "late"
                ? "2026-10-27T12:00:00Z"
                : "2026-10-27T10:00:00Z",
          ),
        ],
      ]),
    ),
    serverConfigs: new Map(),
    scopedProjectKeys: null,
    optimisticDrop: null,
    workingShelfEnabled: false,
    clockKey: "fixture",
  });
  expect(partition.activeThreads).toEqual([]);
  expect(partition.scheduledThreads.map((thread) => thread.id)).toEqual([
    "a",
    "b",
    "late",
    "unknown",
  ]);
});

it("keeps a held queued session in the web inbox instead of Scheduled", () => {
  const environmentId = EnvironmentId.make("queued-environment");
  const thread = {
    ...makeThreadFixture({ id: ThreadId.make("queued"), environmentId, runtime: null }),
    latestRun: {
      runId: RunId.make("held"),
      status: "queued" as const,
      requestedAt: "2026-10-27T08:00:00Z",
      startedAt: null,
      completedAt: null,
      assistantMessageId: null,
    },
  };
  const partition = partitionSidebarThreads({
    threads: [thread],
    schedules: new Map([[`${environmentId}:${thread.id}`, [scheduleFor(thread.id, null)]]]),
    serverConfigs: new Map(),
    scopedProjectKeys: null,
    optimisticDrop: null,
    workingShelfEnabled: false,
    clockKey: "fixture",
  });
  expect(partition.scheduledThreads).toEqual([]);
  expect(partition.activeThreads.map((row) => row.id)).toEqual([thread.id]);
});

const MOUNTED_AT_MS = Date.parse("2026-10-24T08:00:00.000Z");

function WakeClock(props: { readonly threads: ReadonlyArray<{ readonly snoozedUntil: string }> }) {
  return <output>{useSnoozeWakeClock(props.threads)}</output>;
}

describe("useSnoozeWakeClock", () => {
  it("settles in one step when many distinct wakes passed during a sleep", async () => {
    using now = vi.spyOn(Date, "now").mockReturnValue(MOUNTED_AT_MS);
    // More distinct wakes than React's 25 render-phase re-render limit.
    const threads = Array.from({ length: 40 }, (_, index) => ({
      snoozedUntil: new Date(MOUNTED_AT_MS + 1 + index * 60_000).toISOString(),
    }));
    await using screen = await render(<WakeClock threads={threads} />, {
      // A bare hook host; nothing here links or navigates.
      router: false,
    });
    await expect.element(screen.getByRole("status")).toHaveTextContent(String(MOUNTED_AT_MS));

    // The machine resumes after every wake has passed; the first wake's timer fires late.
    const resumedAtMs = MOUNTED_AT_MS + 24 * 60 * 60_000;
    now.mockReturnValue(resumedAtMs);

    // The clock lands on the last elapsed wake, so every woken thread has left the shelf.
    const lastWakeMs = MOUNTED_AT_MS + 1 + 39 * 60_000;
    await expect.element(screen.getByRole("status")).toHaveTextContent(String(lastWakeMs));
  });
});

function JumpHints(props: { readonly held: boolean }) {
  return <output>{useThreadJumpHintsVisible(props.held) ? "shown" : "hidden"}</output>;
}

describe("useThreadJumpHintsVisible", () => {
  it("waits for the delay again on a second hold", async () => {
    // The first render reads the clock.
    using _timers = fakeTimers({ now: 0 });
    await using screen = await render(<JumpHints held />, {
      // A bare hook host; nothing here links or navigates.
      router: false,
    });
    await act(() => vi.advanceTimersByTime(1_000));
    await expect.element(screen.getByRole("status")).toHaveTextContent("shown");

    await screen.rerender(<JumpHints held={false} />);
    await expect.element(screen.getByRole("status")).toHaveTextContent("hidden");
    await act(() => vi.advanceTimersByTime(1_000));

    await screen.rerender(<JumpHints held />);
    await expect.element(screen.getByRole("status")).toHaveTextContent("hidden");
    await act(() => vi.advanceTimersByTime(1_000));
    await expect.element(screen.getByRole("status")).toHaveTextContent("shown");
  });
});
