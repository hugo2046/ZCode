import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { createTestRenderer } from "@mbears/opentui-core/testing";
import { runTuiWithRenderer } from "../src/tui.js";
import type { TuiOptions, TuiStartupOptions } from "../src/types.js";

async function withStartup(
  run: (
    view: Awaited<ReturnType<typeof createTestRenderer>>,
    ready: (expectMain?: boolean) => Promise<void>,
    result: () => number | undefined,
  ) => Promise<void>,
) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let resolveStartup!: (options: TuiStartupOptions) => void;
  let outcome: number | undefined;
  let closed: Promise<number> | undefined;
  let baselineKeyListeners = 0;
  let baselinePasteListeners = 0;
  const startup = new Promise<TuiStartupOptions>((resolve) => {
    resolveStartup = resolve;
  });
  const options: TuiOptions = {
    loadStartupOptions: () => startup,
    locale: "en-US",
    noColor: true,
    stderr: process.stderr,
    stdin: process.stdin,
    stdout: process.stdout,
    submitPrompt: async () => assert.fail("Lifecycle regression must not submit prompts"),
  };
  let view: Awaited<ReturnType<typeof createTestRenderer>> | undefined;
  await act(async () => {
    view = await createTestRenderer({ width: 140, height: 30, exitOnCtrlC: false });
    baselineKeyListeners = view.renderer.keyInput.listenerCount("keypress");
    baselinePasteListeners = view.renderer.keyInput.listenerCount("paste");
    closed = runTuiWithRenderer(options, view.renderer);
    void closed.then((code) => {
      outcome = code;
    });
    await view.renderOnce();
  });
  assert.ok(view);
  const ready = async (expectMain = true) => {
    await act(async () => {
      resolveStartup({});
      await Promise.resolve();
    });
    await act(async () => {
      if (!view!.renderer.isDestroyed) await view!.renderOnce();
    });
    if (expectMain)
      assert.ok(
        view!.captureCharFrame().includes("╭─ Build"),
        "Startup must transition to the composer",
      );
  };
  try {
    await run(view, ready, () => outcome);
  } finally {
    await act(async () => view?.renderer.destroy());
    await closed;
    assert.equal(view.renderer.keyInput.listenerCount("keypress"), baselineKeyListeners);
    assert.equal(view.renderer.keyInput.listenerCount("paste"), baselinePasteListeners);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  }
}

async function key(
  view: Awaited<ReturnType<typeof createTestRenderer>>,
  action: () => void | Promise<void>,
) {
  await act(async () => {
    await action();
    await Promise.resolve();
  });
  await act(async () => {
    if (!view.renderer.isDestroyed) await view.renderOnce();
  });
}

test("startup keyboard listener is removed before main-screen Ctrl-C confirmation", async () => {
  await withStartup(async (view, ready, result) => {
    await ready();
    await key(view, () => view.mockInput.pressCtrlC());
    assert.equal(result(), undefined, "First main-screen Ctrl-C must keep the TUI open");
    assert.ok(
      view.captureCharFrame().includes("Press Ctrl-C again to exit."),
      view.captureCharFrame(),
    );
    await key(view, () => view.mockInput.pressCtrlC());
    assert.equal(result(), 0);
  });
});

test("after startup Ctrl-C clears a draft before arming the empty-input exit guard", async () => {
  await withStartup(async (view, ready, result) => {
    await ready();
    await key(view, () => view.mockInput.typeText("draft to clear"));
    await key(view, () => view.mockInput.pressCtrlC());
    assert.equal(result(), undefined);
    assert.equal(view.captureCharFrame().includes("draft to clear"), false);
    await key(view, () => view.mockInput.pressCtrlC());
    assert.equal(result(), undefined);
    await key(view, () => view.mockInput.pressArrow("left"));
    await key(view, () => view.mockInput.pressCtrlC());
    assert.equal(result(), undefined, "Other keys must reset confirmation");
    await key(view, () => view.mockInput.pressCtrlC());
    assert.equal(result(), 0);
  });
});

test("Ctrl-C can close the startup screen and ignores late runtime readiness", async () => {
  await withStartup(async (view, ready, result) => {
    await key(view, () => view.mockInput.pressCtrlC());
    assert.equal(result(), 130);
    // A late startup result must not mount a new screen after renderer destruction.
    await ready(false);
    assert.equal(result(), 130);
  });
});
