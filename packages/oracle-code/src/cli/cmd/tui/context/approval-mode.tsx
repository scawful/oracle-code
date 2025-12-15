import { createStore } from "solid-js/store"
import { createMemo } from "solid-js"
import { createSimpleContext } from "./helper"

export type ApprovalMode = "manual" | "auto_edits" | "yolo"

export const APPROVAL_MODES: { id: ApprovalMode; name: string; color: string; description: string }[] = [
  {
    id: "manual",
    name: "Manual Approval",
    color: "textMuted",
    description: "Manually approve all tool executions",
  },
  {
    id: "auto_edits",
    name: "Auto-Edit",
    color: "success",
    description: "Automatically approve file edits (edit, write, patch)",
  },
  {
    id: "yolo",
    name: "YOLO Mode",
    color: "error",
    description: "Automatically approve ALL tools (Dangerous)",
  },
]

export const { use: useApprovalMode, provider: ApprovalModeProvider } = createSimpleContext({
  name: "ApprovalMode",
  init: () => {
    const [store, setStore] = createStore<{ mode: ApprovalMode }>({
      mode: "manual",
    })

    const currentModeInfo = createMemo(() => APPROVAL_MODES.find((m) => m.id === store.mode) || APPROVAL_MODES[0])

    return {
      get mode() {
        return store.mode
      },
      get modeInfo() {
        return currentModeInfo()
      },
      setMode(mode: ApprovalMode) {
        setStore("mode", mode)
      },
      cycle() {
        const modes = APPROVAL_MODES.map((m) => m.id)
        const currentIndex = modes.indexOf(store.mode)
        let nextIndex = currentIndex + 1
        if (nextIndex >= modes.length) nextIndex = 0
        setStore("mode", modes[nextIndex])
      },
      isAutoApproved(tool: string) {
        if (store.mode === "yolo") return true
        if (store.mode === "auto_edits") {
          return ["edit", "write", "patch", "todowrite"].includes(tool)
        }
        return false
      },
    }
  },
})
