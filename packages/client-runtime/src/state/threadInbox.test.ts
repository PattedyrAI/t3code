import { EnvironmentId, ProviderInstanceId, RunId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createInboxReturnTracker,
  isThreadWorking,
  resolveThreadSchedule,
  threadRaisedHandWhileSettled,
  formatThreadSchedule,
  sortInboxThreadsByReturn,
  sortWorkingThreadsBySend,
} from "./threadInbox.ts";

const environmentId = EnvironmentId.make("environment-1");

describe("resolveThreadSchedule", () => {
  const task = (id: string, nextRunAt: string | null, enabled = true) => ({
    id,
    threadId: "a",
    enabled,
    nextRunAt,
    lastRunStatus: "succeeded" as const,
  });
  it("selects the earliest enabled binding, ignoring unbound, paused and other threads", () => {
    const early = task("early", "2026-10-27T10:00:00Z");
    expect(
      resolveThreadSchedule(thread("a", false), [
        task("late", "2026-10-27T12:00:00Z"),
        task("paused", "2026-10-27T08:00:00Z", false),
        { ...task("unbound", "2026-10-27T07:00:00Z"), threadId: null },
        { ...task("other", "2026-10-27T06:00:00Z"), threadId: "b" },
        task("unknown", null),
        early,
      ]),
    ).toBe(early);
  });
  it("keeps execution, approval, input, plan review and failures actionable", () => {
    const tasks = [task("one", null)];
    expect(resolveThreadSchedule(thread("a", true), tasks)).toBeNull();
    for (const patch of [
      { hasPendingApprovals: true },
      { hasPendingUserInput: true },
      { hasActionableProposedPlan: true, interactionMode: "plan" as const },
      { pendingGuestMessageCount: 1 },
    ])
      expect(resolveThreadSchedule({ ...thread("a", false), ...patch }, tasks)).toBeNull();
    expect(
      resolveThreadSchedule(thread("a", false), [{ ...tasks[0]!, lastRunStatus: "failed" }]),
    ).toBeNull();
    expect(resolveThreadSchedule(thread("a", false), [])).toBeNull();
    expect(resolveThreadSchedule(thread("a", false), [task("paused", null, false)])).toBeNull();
  });
  it("retains enabled schedules with unknown due times without inventing a due date", () => {
    const unknown = task("unknown", null);
    expect(resolveThreadSchedule(thread("a", false), [unknown])).toBe(unknown);
    expect(resolveThreadSchedule(thread("a", false), [unknown], true)).toBeNull();
  });
  it("keeps held queued turns out of Scheduled even without an active runtime", () => {
    const queued = {
      ...thread("a", false),
      latestRun: {
        runId: RunId.make("held"),
        status: "queued" as const,
        requestedAt: "2026-10-27T08:00:00Z",
        startedAt: null,
        completedAt: null,
        assistantMessageId: null,
      },
    };
    expect(resolveThreadSchedule(queued, [task("one", null)])).toBeNull();
    expect(resolveThreadSchedule(thread("a", false), [task("one", null)], false, true)).toBeNull();
  });
  it("only raises a settled automation for current attention or failures after its settlement", () => {
    const settled = { ...thread("a", false), settledAt: "2026-10-27T08:00:00Z" };
    const tasks = [task("one", null)];
    expect(threadRaisedHandWhileSettled(settled, tasks)).toBe(false);
    expect(threadRaisedHandWhileSettled({ ...settled, hasPendingApprovals: true }, tasks)).toBe(
      true,
    );
    expect(threadRaisedHandWhileSettled({ ...settled, hasPendingUserInput: true }, tasks)).toBe(
      true,
    );
    expect(
      threadRaisedHandWhileSettled(
        { ...settled, interactionMode: "plan", hasActionableProposedPlan: true },
        tasks,
      ),
    ).toBe(true);
    expect(
      threadRaisedHandWhileSettled({ ...settled, hasPendingApprovals: true }, [
        task("paused", null, false),
      ]),
    ).toBe(false);
    const failed = (completedAt: string) => ({
      ...settled,
      latestRun: {
        runId: RunId.make("failed"),
        status: "failed" as const,
        requestedAt: completedAt,
        startedAt: completedAt,
        completedAt,
        assistantMessageId: null,
      },
      runtime: {
        ...thread("a", true).runtime!,
        status: "failed" as const,
        lastError: "Failed",
        updatedAt: "2026-10-27T09:00:00Z",
      },
    });
    expect(threadRaisedHandWhileSettled(failed("2026-10-27T08:01:00Z"), tasks)).toBe(true);
    expect(threadRaisedHandWhileSettled(failed("2026-10-27T07:59:00Z"), tasks)).toBe(false);
  });
});

describe("formatThreadSchedule", () => {
  const fixed = {
    schedule: { type: "fixed_time" as const, timeOfDay: "10:00" },
    nextRunAt: "2026-10-27T10:00:00Z",
  };
  it("formats the server instant in its environment zone and the user's clock format", () => {
    expect(formatThreadSchedule(fixed, 0, "24-hour", "UTC")).toMatch(/10:00.*UTC/);
    expect(formatThreadSchedule(fixed, 0, "12-hour", "UTC")).toMatch(/10:00.*AM.*UTC/);
    expect(formatThreadSchedule(fixed, 0, "24-hour", "Europe/Oslo")).toMatch(/11:00/);
    const summer = { ...fixed, nextRunAt: "2026-07-01T10:00:00Z" };
    expect(formatThreadSchedule(summer, 0, "24-hour", "Europe/Oslo")).toMatch(/12:00/);
    expect(formatThreadSchedule(fixed, 0, "24-hour")).toBe("Timezone unknown");
    expect(formatThreadSchedule(fixed, 0, "24-hour", "invalid")).toBe("Timezone unknown");
  });
  it("uses elapsed time for intervals and never invents a missing or expired due time", () => {
    const interval = { ...fixed, schedule: { type: "interval" as const, everyMs: 7_200_000 } };
    expect(formatThreadSchedule(interval, Date.parse("2026-10-27T08:00:00Z"), "locale")).toBe(
      "in 2h",
    );
    expect(formatThreadSchedule(interval, Date.parse("2026-10-27T09:59:00Z"), "locale")).toBe(
      "in 1m",
    );
    expect(formatThreadSchedule(interval, Date.parse(fixed.nextRunAt), "locale")).toBe("Due");
    expect(formatThreadSchedule({ ...interval, nextRunAt: null }, 0, "locale")).toBe(
      "Next run unknown",
    );
  });
  it("disambiguates Oslo DST boundaries using the supplied environment zone", () => {
    const label = (instant: string) =>
      formatThreadSchedule({ ...fixed, nextRunAt: instant }, 0, "24-hour", "Europe/Oslo");
    expect(label("2026-03-29T00:30:00Z")).toMatch(/01:30/);
    expect(label("2026-03-29T01:30:00Z")).toMatch(/03:30/);
    const first = label("2026-10-25T00:30:00Z");
    const second = label("2026-10-25T01:30:00Z");
    expect(first).toMatch(/02:30/);
    expect(second).toMatch(/02:30/);
    expect(first).not.toBe(second);
    expect(formatThreadSchedule(fixed, 0, "locale", "Etc/Unknown")).toBe("Timezone unknown");
  });
  it("includes the weekday for a fixed-time run on another environment-local day", () => {
    const weekly = {
      schedule: { type: "fixed_time" as const, timeOfDay: "10:00", weekdays: [5] },
      nextRunAt: "2026-10-30T09:00:00Z",
    };
    expect(
      formatThreadSchedule(weekly, Date.parse("2026-10-27T08:00:00Z"), "24-hour", "Europe/Oslo"),
    ).toMatch(/Fri.*10:00.*(?:CET|GMT\+1)/);
    expect(
      formatThreadSchedule(weekly, Date.parse("2026-10-30T08:00:00Z"), "24-hour", "Europe/Oslo"),
    ).not.toMatch(/Fri/);
    const midnight = { ...weekly, nextRunAt: "2026-10-29T23:30:00Z" };
    expect(
      formatThreadSchedule(midnight, Date.parse("2026-10-29T22:30:00Z"), "24-hour", "Europe/Oslo"),
    ).toMatch(/Fri.*00:30/);
  });
});

function thread(id: string, working: boolean) {
  return {
    id: ThreadId.make(id),
    environmentId,
    createdAt: "2026-06-01T00:00:00.000Z",
    unsettledAt: null,
    latestRun: null,
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    interactionMode: "default" as const,
    runtime: working
      ? {
          status: "running" as const,
          activeRunId: null,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerName: "Codex",
          lastError: null,
          updatedAt: "2026-06-01T00:00:00.000Z",
        }
      : null,
  };
}

describe("createInboxReturnTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it("stamps a thread when it stops working, but never on the first observation", () => {
    const tracker = createInboxReturnTracker();
    const first = tracker.observe([thread("a", true), thread("b", false)]);
    expect(first.returnedAt(thread("a", true))).toBeUndefined();
    expect(first.returnedAt(thread("b", false))).toBeUndefined();

    const held = tracker.observe([thread("a", false), thread("b", false)]);
    vi.advanceTimersByTime(2_000);
    const second = tracker.observe([thread("a", false), thread("b", false)]);
    expect(second.returnedAt(thread("a", false))).toBeDefined();
    expect(second.returnedAt(thread("b", false))).toBeUndefined();
    expect(tracker.returnedAt(thread("a", false))).toBe(second.returnedAt(thread("a", false)));
    // An earlier observation keeps its answer, so lists built from it stay valid.
    expect(held.isWorking(thread("a", false))).toBe(true);
    expect(held.returnedAt(thread("a", false))).toBeUndefined();
  });

  it("holds only placement, then expires and notifies without another shell event", () => {
    const tracker = createInboxReturnTracker();
    const notify = vi.fn();
    const unsubscribe = tracker.subscribe(notify);
    tracker.observe([thread("a", true)]);
    tracker.observe([thread("a", false)]);
    expect(isThreadWorking(thread("a", false))).toBe(false);
    expect(tracker.isWorking(thread("a", false))).toBe(true);
    vi.advanceTimersByTime(1_999);
    tracker.observe([thread("a", false)]);
    expect(tracker.isWorking(thread("a", false))).toBe(true);
    expect(tracker.returnedAt(thread("a", false))).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(tracker.isWorking(thread("a", false))).toBe(false);
    expect(tracker.returnedAt(thread("a", false))).toBe(12_000);
    expect(notify).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("returns an automation to Scheduled after execution grace without another idle ping", () => {
    const tracker = createInboxReturnTracker();
    const idle = thread("automation", false);
    const task = {
      id: "task",
      threadId: idle.id,
      enabled: true,
      nextRunAt: null,
      lastRunStatus: "succeeded",
    };
    tracker.observe([thread("automation", true)]);
    const finishing = tracker.observe([idle]);
    expect(resolveThreadSchedule(idle, [task], finishing.isWorking(idle))).toBeNull();
    vi.advanceTimersByTime(2_000);
    expect(resolveThreadSchedule(idle, [task], tracker.isWorking(idle))).toBe(task);
    const returnedAt = tracker.returnedAt(idle);
    tracker.observe([idle]);
    vi.advanceTimersByTime(60_000);
    tracker.observe([idle]);
    expect(tracker.returnedAt(idle)).toBe(returnedAt);
    expect(resolveThreadSchedule(idle, [task], tracker.isWorking(idle))).toBe(task);
  });

  it("cancels a transient return on resume and grants a fresh grace after the next finish", () => {
    const tracker = createInboxReturnTracker();
    tracker.observe([thread("a", false)]);
    expect(tracker.isWorking(thread("a", false))).toBe(false);
    tracker.observe([thread("a", true)]);
    expect(tracker.isWorking(thread("a", true))).toBe(true);
    tracker.observe([thread("a", false)]);
    vi.advanceTimersByTime(1_500);
    tracker.observe([thread("a", true)]);
    vi.advanceTimersByTime(1_000);
    expect(tracker.returnedAt(thread("a", true))).toBeUndefined();
    tracker.observe([thread("a", false)]);
    vi.advanceTimersByTime(1_999);
    expect(tracker.isWorking(thread("a", false))).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tracker.returnedAt(thread("a", false))).toBe(14_500);
  });

  it.each([
    { hasPendingApprovals: true },
    { hasPendingUserInput: true },
    { pendingSubagentRequest: "approval" as const },
    { pendingSubagentRequest: "user_input" as const },
    { pendingGuestMessageCount: 1 },
    { interactionMode: "plan" as const, hasActionableProposedPlan: true },
    { runtime: { ...thread("a", true).runtime!, status: "failed" as const, lastError: "failed" } },
    { pinnedAt: "2026-06-01T00:00:01Z" },
    { settledOverride: "settled" as const },
    { snoozedUntil: "2026-06-02T00:00:00Z" },
    { activeOrderKey: "manual-order" },
  ])("ends a grace immediately for attention or manual placement: %j", (change) => {
    const tracker = createInboxReturnTracker();
    tracker.observe([thread("a", true)]);
    tracker.observe([thread("a", false)]);
    tracker.observe([{ ...thread("a", false), ...change }]);
    expect(tracker.isWorking(thread("a", false))).toBe(false);
    expect(tracker.returnedAt(thread("a", false))).toBe(10_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["interrupted", "cancelled", "rolled_back"] as const)(
    "holds a %s run, because the server can still settle it",
    (status) => {
      const tracker = createInboxReturnTracker();
      const stopped = {
        ...thread("a", false),
        latestRun: {
          runId: RunId.make("stopped"),
          status,
          requestedAt: null,
          startedAt: null,
          completedAt: null,
          assistantMessageId: null,
        },
      };
      tracker.observe([thread("a", true)]);
      tracker.observe([stopped]);
      expect(tracker.isWorking(stopped)).toBe(true);
      tracker.observe([{ ...stopped, settledOverride: "settled" as const }]);
      expect(tracker.isWorking(stopped)).toBe(false);
    },
  );

  it("grants grace after a retained expired snooze", () => {
    const tracker = createInboxReturnTracker();
    const retained = {
      snoozedAt: "1970-01-01T00:00:01.000Z",
      snoozedUntil: "1970-01-01T00:00:05.000Z",
      latestRun: {
        runId: RunId.make("completed-wake"),
        status: "completed" as const,
        requestedAt: "1970-01-01T00:00:02.000Z",
        startedAt: "1970-01-01T00:00:02.000Z",
        completedAt: "1970-01-01T00:00:09.000Z",
        assistantMessageId: null,
      },
    };
    const active = { ...thread("a", true), ...retained };
    const finished = { ...thread("a", false), ...retained };
    tracker.observe([active]);
    tracker.observe([finished]);
    expect(tracker.isWorking(finished)).toBe(true);
    expect(tracker.returnedAt(finished)).toBeUndefined();
    vi.advanceTimersByTime(1_999);
    expect(tracker.isWorking(finished)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tracker.isWorking(finished)).toBe(false);
    expect(tracker.returnedAt(finished)).toBe(12_000);
  });

  it("does not grant grace to a future snooze after background completion", () => {
    const tracker = createInboxReturnTracker();
    const retained = {
      snoozedAt: "1970-01-01T00:00:01.000Z",
      snoozedUntil: "1970-01-01T00:00:30.000Z",
    };
    tracker.observe([{ ...thread("a", true), ...retained }]);
    const finished = { ...thread("a", false), ...retained };
    tracker.observe([finished]);
    expect(tracker.isWorking(finished)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stamps only stable returns and sorts them in their actual return order", () => {
    const tracker = createInboxReturnTracker();
    const a = { ...thread("a", false), createdAt: "1970-01-01T00:00:00Z" };
    const b = { ...thread("b", false), createdAt: "1970-01-01T00:00:00Z" };
    tracker.observe([thread("a", true), thread("b", true)]);
    tracker.observe([a, thread("b", true)]);
    vi.advanceTimersByTime(500);
    tracker.observe([a, b]);
    vi.advanceTimersByTime(1_500);
    expect(tracker.returnedAt(a)).toBe(12_000);
    expect(tracker.returnedAt(b)).toBeUndefined();
    vi.advanceTimersByTime(500);
    expect(sortInboxThreadsByReturn([a, b], tracker.returnedAt).map((entry) => entry.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("cancels pending timers for removed threads and disabled shelves", () => {
    const tracker = createInboxReturnTracker();
    const notify = vi.fn();
    tracker.subscribe(notify);
    tracker.observe([thread("a", true)]);
    tracker.observe([thread("a", false)]);
    tracker.observe([]);
    expect(vi.getTimerCount()).toBe(0);
    tracker.observe([thread("a", true)]);
    tracker.observe([thread("a", false)]);
    tracker.observe(null);
    vi.advanceTimersByTime(2_000);
    expect(notify).not.toHaveBeenCalled();
    expect(tracker.returnedAt(thread("a", false))).toBeUndefined();
  });
});

describe("sortWorkingThreadsBySend", () => {
  it("orders by the last message the user sent, not by later runs", () => {
    const sentFirst = {
      ...thread("sent-first", true),
      latestUserAuthoredMessageAt: "2026-06-01T01:00:00.000Z",
      latestRun: {
        runId: RunId.make("run:wake"),
        status: "running" as const,
        requestedAt: "2026-06-01T04:00:00.000Z",
        startedAt: "2026-06-01T04:00:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    };
    const sentLast = {
      ...thread("sent-last", true),
      latestUserAuthoredMessageAt: "2026-06-01T02:00:00.000Z",
    };
    const launched = { ...thread("launched", true), latestUserAuthoredMessageAt: null };
    expect(
      sortWorkingThreadsBySend([launched, sentFirst, sentLast]).map((thread) => thread.id),
    ).toEqual(["sent-last", "sent-first", "launched"]);
  });
});
