import { TextareaRenderable, TextAttributes, InputRenderable } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { createSignal, onMount, Show, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { State } from "@/state"

const SECTIONS: State.Section[] = ["facts", "assumptions", "decisions", "uncertainties", "goals", "context"]

export type DialogStateEditProps = {
  mode: "create" | "edit"
  initialKey?: string
  initialValue?: string
  initialSection?: State.Section
}

export function DialogStateEdit(props: DialogStateEditProps) {
  const dialog = useDialog()
  const sync = useSync()
  const { theme } = useTheme()

  const [step, setStep] = createSignal<"key" | "section" | "value">(props.mode === "edit" ? "value" : "key")
  const [key, setKey] = createSignal(props.initialKey ?? "")
  const [section, setSection] = createSignal<State.Section>(props.initialSection ?? "context")
  const [selectedSectionIndex, setSelectedSectionIndex] = createSignal(
    SECTIONS.indexOf(props.initialSection ?? "context"),
  )

  let keyInput: InputRenderable
  let valueTextarea: TextareaRenderable

  const handleSave = async (value: string) => {
    await sync.state.set(key(), value, section())
    dialog.clear()
  }

  useKeyboard((evt) => {
    if (step() === "key" && evt.name === "return") {
      if (key().trim()) {
        setStep("section")
      }
    } else if (step() === "section") {
      if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
        setSelectedSectionIndex((i) => (i <= 0 ? SECTIONS.length - 1 : i - 1))
        setSection(SECTIONS[selectedSectionIndex()])
      } else if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
        setSelectedSectionIndex((i) => (i >= SECTIONS.length - 1 ? 0 : i + 1))
        setSection(SECTIONS[selectedSectionIndex()])
      } else if (evt.name === "return") {
        setSection(SECTIONS[selectedSectionIndex()])
        setStep("value")
        setTimeout(() => valueTextarea?.focus(), 10)
      }
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    if (props.mode === "create") {
      setTimeout(() => keyInput?.focus(), 10)
    } else {
      setTimeout(() => valueTextarea?.focus(), 10)
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD}>
          {props.mode === "create" ? "Add State Entry" : `Edit: ${props.initialKey}`}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      {/* Step 1: Key input (only for create mode) */}
      <Show when={step() === "key"}>
        <box gap={1}>
          <text fg={theme.text}>Enter a key name:</text>
          <input
            ref={(r) => (keyInput = r)}
            onInput={(e) => setKey(e)}
            placeholder="e.g., project_goal, current_task"
            focusedBackgroundColor={theme.backgroundPanel}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
          />
          <text fg={theme.textMuted}>
            Press <b>enter</b> to continue
          </text>
        </box>
      </Show>

      {/* Step 2: Section selection */}
      <Show when={step() === "section"}>
        <box gap={1}>
          <text fg={theme.text}>
            Select a section for "<b>{key()}</b>":
          </text>
          <box paddingLeft={1}>
            <For each={SECTIONS}>
              {(s, i) => (
                <box flexDirection="row" gap={1}>
                  <text fg={i() === selectedSectionIndex() ? theme.primary : theme.textMuted}>
                    {i() === selectedSectionIndex() ? "●" : "○"}
                  </text>
                  <text fg={i() === selectedSectionIndex() ? theme.text : theme.textMuted}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </text>
                </box>
              )}
            </For>
          </box>
          <text fg={theme.textMuted}>
            Use <b>↑/↓</b> to select, <b>enter</b> to continue
          </text>
        </box>
      </Show>

      {/* Step 3: Value input */}
      <Show when={step() === "value"}>
        <box gap={1}>
          <Show when={props.mode === "create"}>
            <text fg={theme.textMuted}>
              Key: <b>{key()}</b> | Section: <b>{section()}</b>
            </text>
          </Show>
          <Show when={props.mode === "edit"}>
            <text fg={theme.textMuted}>
              Section: <b>{section()}</b>
            </text>
          </Show>
          <text fg={theme.text}>Enter the value:</text>
          <textarea
            onSubmit={() => handleSave(valueTextarea.plainText)}
            height={5}
            keyBindings={[{ name: "return", action: "submit" }]}
            ref={(val: TextareaRenderable) => {
              valueTextarea = val
              if (props.initialValue) {
                valueTextarea.gotoLineEnd()
              }
            }}
            initialValue={props.initialValue}
            placeholder="Enter the state value..."
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
          />
          <text fg={theme.textMuted}>
            Press <b>enter</b> to save
          </text>
        </box>
      </Show>
    </box>
  )
}
