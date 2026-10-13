import { decodePasteBytes, stripAnsiSequences } from "@mbears/opentui-core";
import { flushSync, usePaste } from "@mbears/opentui-react";
import type { Dispatch, SetStateAction } from "react";
import type { SelectionState } from "./app-model.js";
import { updateSelectionInputValue } from "./app-selection-keyboard.js";

const INPUT_CONTROL_CHARACTERS = /\p{Cc}/gu;

export function useSelectionPaste(
  selection: SelectionState | undefined,
  setSelection: Dispatch<SetStateAction<SelectionState | undefined>>,
): void {
  usePaste((event) => {
    if (!selection) return;
    // 终端 bracketed paste 是独立事件；选择面板必须接管，避免落入隐藏的普通编辑器。
    event.preventDefault();
    event.stopPropagation();
    const input = selection.input;
    if (!input || selection.pending) return;
    // API Key 是单行输入，粘贴的换行与终端控制序列不能触发提交或进入密钥。
    const text = stripAnsiSequences(decodePasteBytes(event.bytes)).replace(
      INPUT_CONTROL_CHARACTERS,
      "",
    );
    if (!text) return;
    // 粘贴和显式 Enter 可同批到达，必须先提交 React 输入状态再处理后续事件。
    flushSync(() => {
      updateSelectionInputValue(input.itemId, setSelection, (value) => `${value}${text}`);
    });
  });
}
