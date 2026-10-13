import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { testRender } from "@mbears/opentui-react/test-utils";
import { TuiApp } from "../src/app.js";
import type { TuiOptions, TuiPromptInput, TuiSelection } from "../src/types.js";

const setupSelection: TuiSelection = {
  emptyMessage: "No setup methods.",
  filterable: false,
  items: [
    {
      command: "/login example-api-key",
      id: "example-api-key",
      primary: "Example API Key",
      input: {
        mask: true,
        placeholder: "Paste API key",
        primary: "Enter example API Key",
        emptyStatus: "API key is required.",
      },
    },
  ],
  prompt: "Choose a setup method.",
  title: "Set Up Coding Plan",
};

async function withSetupPanel(
  run: (view: Awaited<ReturnType<typeof testRender>>, submitted: TuiPromptInput[]) => Promise<void>,
) {
  const submitted: TuiPromptInput[] = [];
  const options: TuiOptions = {
    locale: "en-US",
    noColor: true,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    submitPrompt: async (input) => {
      if (input === "/login") return { response: "", selection: setupSelection };
      submitted.push(input);
      return { response: "saved by offline fixture" };
    },
  };
  let view: Awaited<ReturnType<typeof testRender>> | undefined;
  await act(async () => {
    view = await testRender(
      React.createElement(TuiApp, {
        options,
        onExit: () => assert.fail("Setup input must not exit the TUI"),
        copySelection: async () => ({ kind: "empty" }),
        hasCopyableSelection: () => false,
      }),
      { width: 100, height: 30, exitOnCtrlC: false, kittyKeyboard: true, otherModifiersMode: true },
    );
    await view.renderOnce();
  });
  assert.ok(view);
  try {
    await input(view, () => view!.mockInput.typeText("/login"));
    await input(view, () => view!.mockInput.pressEnter());
    assert.ok(view.captureCharFrame().includes("Set Up Coding Plan"));
    await input(view, () => view!.mockInput.pressEnter());
    assert.ok(view.captureCharFrame().includes("Paste API key"));
    await run(view, submitted);
  } finally {
    await act(async () => view?.renderer.destroy());
  }
}

async function input(
  view: Awaited<ReturnType<typeof testRender>>,
  action: () => void | Promise<void>,
) {
  await act(async () => {
    await action();
    await Promise.resolve();
  });
  await act(async () => {
    await view.renderOnce();
  });
}

test("bracketed API key paste is masked, appends to typing and supports backspace", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, () => view.mockInput.typeText("dummy-"));
    await input(view, () => view.mockInput.pasteBracketedText("paste"));
    const frame = view.captureCharFrame();
    assert.ok(frame.includes("> ***********"), view.captureCharFrame());
    assert.equal(frame.includes("dummy-paste"), false);
    assert.deepEqual(submitted, []);
    await input(view, () => view.mockInput.pressBackspace());
    await input(view, () => view.mockInput.pressEnter());
    assert.deepEqual(submitted, ["/login example-api-key dummy-past"]);
  });
});

test("API key paste strips terminal controls without treating newlines as submit", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, () => view.mockInput.pasteBracketedText("\x1b[31mdummy-\x1b[0m\r\npaste\t"));
    assert.deepEqual(submitted, []);
    assert.ok(view.captureCharFrame().includes("> ***********"));
    await input(view, () => view.mockInput.pressEnter());
    assert.deepEqual(submitted, ["/login example-api-key dummy-paste"]);
  });
});

test("clearing, cancelling and re-entering API key setup discards the old input", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, () => view.mockInput.pasteBracketedText("dummy-old"));
    await input(view, () => view.mockInput.pressKey("u", { ctrl: true }));
    await input(view, () => view.mockInput.pressEnter());
    assert.deepEqual(submitted, []);
    assert.ok(view.captureCharFrame().includes("Paste API key"));
    await input(view, () => view.mockInput.typeText("discarded"));
    await input(view, () => view.mockInput.pressEscape());
    assert.ok(view.captureCharFrame().includes("Example API Key"), view.captureCharFrame());
    await input(view, () => view.mockInput.pasteBracketedText("ignored-in-picker"));
    await input(view, () => view.mockInput.pressEnter());
    assert.ok(view.captureCharFrame().includes("Paste API key"));
    await input(view, () => view.mockInput.pasteBracketedText("dummy-new"));
    await input(view, () => view.mockInput.pressEnter());
    assert.deepEqual(submitted, ["/login example-api-key dummy-new"]);
  });
});

test("consecutive paste events preserve both chunks before the next render", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, async () => {
      await view.mockInput.pasteBracketedText("dummy-");
      await view.mockInput.pasteBracketedText("two");
    });
    await input(view, () => view.mockInput.pressEnter());
    assert.deepEqual(submitted, ["/login example-api-key dummy-two"]);
  });
});

test("ordinary API key character bursts retain every character", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, () => view.mockInput.typeText("dummy-typed"));
    await input(view, () => view.mockInput.pressEnter());
    assert.deepEqual(submitted, ["/login example-api-key dummy-typed"]);
  });
});

test("normal composer still handles bracketed paste after setup is cancelled", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, () => view.mockInput.pressEscape());
    await input(view, () => view.mockInput.pressEscape());
    await input(view, () => view.mockInput.pasteBracketedText("plain prompt"));
    await input(view, () => view.mockInput.pressEnter());
    assert.deepEqual(submitted, ["plain prompt"]);
  });
});

test("API key paste followed immediately by Enter submits the newly pasted value", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, async () => {
      await view.mockInput.pasteBracketedText("dummy-immediate");
      view.mockInput.pressEnter();
    });
    assert.deepEqual(submitted, ["/login example-api-key dummy-immediate"]);
  });
});

test("ordinary input followed immediately by Enter submits all new characters", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, async () => {
      await view.mockInput.typeText("dummy-immediate");
      view.mockInput.pressEnter();
    });
    assert.deepEqual(submitted, ["/login example-api-key dummy-immediate"]);
  });
});

test("Backspace immediately followed by Enter submits the shortened API key", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, () => view.mockInput.pasteBracketedText("dummy-key"));
    await input(view, () => {
      view.mockInput.pressBackspace();
      view.mockInput.pressEnter();
    });
    assert.deepEqual(submitted, ["/login example-api-key dummy-ke"]);
  });
});

test("Ctrl-U immediately followed by Enter cannot submit the cleared API key", async () => {
  await withSetupPanel(async (view, submitted) => {
    await input(view, () => view.mockInput.pasteBracketedText("dummy-key"));
    await input(view, () => {
      view.mockInput.pressKey("u", { ctrl: true });
      view.mockInput.pressEnter();
    });
    assert.deepEqual(submitted, []);
    assert.ok(view.captureCharFrame().includes("Paste API key"));
  });
});
