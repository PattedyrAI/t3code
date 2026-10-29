import { describe, expect, it } from "vite-plus/test";

import {
  buildPendingUserInputAnswers,
  isPendingUserInputOptionSelected,
  resolvePendingUserInputAnswer,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
} from "./pendingUserInput.ts";

const singleSelectQuestion = {
  id: "scope",
  header: "Scope",
  question: "What should the plan target first?",
  options: [
    { label: "Orchestration-first", description: "Focus on orchestration first" },
    { label: "Node.js", description: "Reuse TypeScript" },
  ],
  multiSelect: false,
} as const;

const nativeChoiceQuestion = {
  id: "result",
  header: "Result",
  question: "Which result should be used?",
  options: [
    { value: " first\t", label: "Result", description: "First result" },
    { value: "second", label: "Result", description: "Second result" },
  ],
  allowCustomAnswer: false,
  multiSelect: false,
} as const;

describe("resolvePendingUserInputAnswer", () => {
  it("preserves exact editor text, including a deliberately cleared answer", () => {
    const question = { ...singleSelectQuestion, initialAnswer: "  Proposed message\n" };
    expect(resolvePendingUserInputAnswer(question, { customAnswer: question.initialAnswer })).toBe(
      question.initialAnswer,
    );
    expect(resolvePendingUserInputAnswer(question, { customAnswer: "  Edited message\n\n" })).toBe(
      "  Edited message\n\n",
    );
    expect(resolvePendingUserInputAnswer(question, { customAnswer: "" })).toBe("");
    expect(resolvePendingUserInputAnswer(question, { customAnswer: " \n" })).toBe(" \n");
    expect(
      setPendingUserInputCustomAnswer(
        question,
        { selectedOptionValues: ["Orchestration-first"] },
        "",
      ),
    ).toEqual({ customAnswer: "" });
  });

  it("submits a selected option together with additional information", () => {
    expect(
      resolvePendingUserInputAnswer(singleSelectQuestion, {
        selectedOptionValues: ["Orchestration-first"],
        customAnswer: "Keep the existing envelope for one release",
      }),
    ).toEqual(["Orchestration-first", "Keep the existing envelope for one release"]);
  });

  it("does not replace a required choice with a custom answer", () => {
    expect(
      resolvePendingUserInputAnswer(nativeChoiceQuestion, {
        selectedOptionValues: ["second"],
        customAnswer: "Use another result",
      }),
    ).toBe("second");
  });

  it("does not submit labels or unknown values when an option has a value", () => {
    expect(
      resolvePendingUserInputAnswer(nativeChoiceQuestion, {
        selectedOptionValues: ["Result", "unknown"],
      }),
    ).toBeNull();
  });

  it("matches a label only for an option without a value", () => {
    expect(
      resolvePendingUserInputAnswer(singleSelectQuestion, { selectedOptionValues: [" Node.js "] }),
    ).toBe("Node.js");
  });

  it("accepts ready attachment-only answers while preserving selected options", () => {
    expect(resolvePendingUserInputAnswer(singleSelectQuestion, { attachmentCount: 1 })).toBe("");
    expect(
      resolvePendingUserInputAnswer(singleSelectQuestion, {
        attachmentCount: 1,
        selectedOptionValues: ["Node.js"],
      }),
    ).toBe("Node.js");
    expect(
      resolvePendingUserInputAnswer(singleSelectQuestion, {
        attachmentCount: 1,
        attachmentsBlocked: true,
      }),
    ).toBeNull();
    expect(
      resolvePendingUserInputAnswer(
        { ...singleSelectQuestion, allowCustomAnswer: false },
        { attachmentCount: 1 },
      ),
    ).toBeNull();
  });
});

describe("togglePendingUserInputOptionSelection", () => {
  it("selects and removes options with the same label independently", () => {
    const question = { ...nativeChoiceQuestion, multiSelect: true };
    const firstSelected = togglePendingUserInputOptionSelection(question, undefined, " first\t");
    const bothSelected = togglePendingUserInputOptionSelection(question, firstSelected, "second");

    expect(buildPendingUserInputAnswers([question], { result: bothSelected })).toEqual({
      result: [" first\t", "second"],
    });

    const secondSelected = togglePendingUserInputOptionSelection(
      question,
      bothSelected,
      " first\t",
    );
    expect(buildPendingUserInputAnswers([question], { result: secondSelected })).toEqual({
      result: ["second"],
    });
  });

  it("submits raw option values and leaves the draft alone for an unknown option", () => {
    const first = togglePendingUserInputOptionSelection(
      nativeChoiceQuestion,
      undefined,
      " first\t",
    );
    expect(isPendingUserInputOptionSelected(nativeChoiceQuestion, first, " first\t")).toBe(true);
    expect(isPendingUserInputOptionSelected(nativeChoiceQuestion, first, "second")).toBe(false);
    expect(buildPendingUserInputAnswers([nativeChoiceQuestion], { result: first })).toEqual({
      result: " first\t",
    });
    expect(togglePendingUserInputOptionSelection(nativeChoiceQuestion, first, "Result")).toBe(
      first,
    );
  });
});

describe("setPendingUserInputCustomAnswer", () => {
  it("rejects arbitrary text when the provider only accepts offered options", () => {
    expect(setPendingUserInputCustomAnswer(nativeChoiceQuestion, undefined, "Other")).toEqual({});
    expect(
      buildPendingUserInputAnswers([nativeChoiceQuestion], { result: { customAnswer: "Other" } }),
    ).toBeNull();
    expect(
      buildPendingUserInputAnswers([nativeChoiceQuestion], {
        result: { selectedOptionValues: ["second"], customAnswer: "stale draft" },
      }),
    ).toEqual({ result: "second" });
  });
});

const compatQuestion = {
  id: "compat",
  header: "Compat",
  question: "How strict should compatibility be?",
  options: [{ label: "Keep current envelope", description: "Preserve current wire format" }],
  multiSelect: false,
} as const;

describe("buildPendingUserInputAnswers", () => {
  it("returns a canonical answer map for complete prompts", () => {
    expect(
      buildPendingUserInputAnswers([singleSelectQuestion, compatQuestion], {
        scope: { selectedOptionValues: ["Orchestration-first"] },
        compat: { customAnswer: "Keep the current envelope for one release window" },
      }),
    ).toEqual({
      scope: "Orchestration-first",
      compat: "Keep the current envelope for one release window",
    });
  });
});

it.each([false, true])(
  "keeps selections and text in either interaction order (multiSelect=%s)",
  (multiSelect) => {
    const question = { ...nativeChoiceQuestion, allowCustomAnswer: true, multiSelect };
    const selected = togglePendingUserInputOptionSelection(question, undefined, " first\t");
    const withText = setPendingUserInputCustomAnswer(question, selected, "Also include examples");
    expect(isPendingUserInputOptionSelected(question, withText, " first\t")).toBe(true);
    expect(buildPendingUserInputAnswers([question], { result: withText })).toEqual({
      result: [" first\t", "Also include examples"],
    });
    const typedFirst = setPendingUserInputCustomAnswer(
      question,
      undefined,
      "Also include examples",
    );
    const selectedAfterText = togglePendingUserInputOptionSelection(
      question,
      typedFirst,
      " first\t",
    );
    expect(resolvePendingUserInputAnswer(question, selectedAfterText)).toEqual([
      " first\t",
      "Also include examples",
    ]);
    expect(
      resolvePendingUserInputAnswer(
        question,
        setPendingUserInputCustomAnswer(question, withText, ""),
      ),
    ).toEqual(multiSelect ? [" first\t"] : " first\t");
    expect(
      resolvePendingUserInputAnswer(
        question,
        togglePendingUserInputOptionSelection(question, withText, " first\t"),
      ),
    ).toBe("Also include examples");
  },
);
