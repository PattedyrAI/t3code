import { EnvironmentId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";

vi.mock(import("../ChatMarkdown"), async () => {
  const { memo } = await import("react");
  return { default: memo(({ text }: { text: string }) => <p>{text}</p>) };
});

import { act, fakeTimers, render } from "../../../test/render";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";

it.each([false, true])(
  "keeps the question open for selections plus details (multiSelect=%s)",
  async (multiSelect) => {
    const onSubmit = vi.fn();
    const question = {
      id: "formats",
      header: "Export formats",
      question: "Which export formats?",
      options: [
        { label: "CSV", description: "Tabular data" },
        { label: "JSON", description: "Structured data" },
      ],
      multiSelect,
    };
    function Question() {
      const [draft, setDraft] = useState<PendingUserInputDraftAnswer>();
      return (
        <>
          <ComposerPendingUserInputPanel
            pendingUserInputs={[
              {
                requestId: RuntimeRequestId.make("selection-details"),
                createdAt: "2026-10-28T00:00:00.000Z",
                dismissible: false,
                responseCapability: "live",
                questions: [question],
              },
            ]}
            cwd={undefined}
            threadRef={{
              environmentId: EnvironmentId.make("test"),
              threadId: ThreadId.make("selection-details"),
            }}
            respondingRequestIds={[]}
            answers={{ formats: draft ?? {} }}
            questionIndex={0}
            onToggleOption={(_, value) =>
              setDraft((current) => togglePendingUserInputOptionSelection(question, current, value))
            }
            onAdvance={() =>
              onSubmit(buildPendingUserInputAnswers([question], { formats: draft ?? {} }))
            }
            onDismiss={() => {}}
          />
          <input
            aria-label="Additional information"
            value={draft?.customAnswer ?? ""}
            onChange={(event) =>
              setDraft((current) =>
                setPendingUserInputCustomAnswer(question, current, event.target.value),
              )
            }
          />
          <button
            type="button"
            onClick={() =>
              onSubmit(buildPendingUserInputAnswers([question], { formats: draft ?? {} }))
            }
          >
            Submit answer
          </button>
        </>
      );
    }
    await using screen = await render(<Question />);
    using _timers = fakeTimers();
    const csv = screen.getByRole("button", { name: /CSV/ });
    const json = screen.getByRole("button", { name: /JSON/ });
    await csv.click();
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(onSubmit).not.toHaveBeenCalled();
    await screen.getByRole("textbox", { name: "Additional information" }).fill("Also include YAML");
    await expect.element(csv).toHaveAttribute("aria-pressed", "true");
    await json.click();
    await expect.element(screen.getByRole("textbox")).toHaveValue("Also include YAML");
    await expect.element(json).toHaveAttribute("aria-pressed", "true");
    await expect.element(csv).toHaveAttribute("aria-pressed", String(multiSelect));
    await screen.getByRole("button", { name: "Submit answer" }).click();
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      formats: multiSelect ? ["CSV", "JSON", "Also include YAML"] : ["JSON", "Also include YAML"],
    });
  },
);
