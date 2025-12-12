import { TextAttributes } from "@opentui/core"
import { createStore } from "solid-js/store"
import { For, Show, createMemo } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { Locale } from "@/util/locale"
import { ErrorDetection } from "@/metrics/errors"

export type DialogTaskOutcomeProps = {
  title: string
  description: string
  errors: ErrorDetection.DetectedError[]
  tokens?: number
  durationMs?: number
  onConfirm?: () => void
  onCancel?: () => void
}

export function DialogTaskOutcome(props: DialogTaskOutcomeProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    active: "confirm" as "confirm" | "cancel",
  })

  const metaLine = createMemo(() => {
    const parts: string[] = []
    if (typeof props.tokens === "number") parts.push(`${Locale.number(props.tokens)} tokens`)
    if (typeof props.durationMs === "number") parts.push(Locale.duration(props.durationMs))
    return parts.join(" · ")
  })

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    if (evt.name === "escape" || evt.name === "esc") {
      props.onCancel?.()
      dialog.clear()
      return
    }
    if (evt.name === "return") {
      if (store.active === "confirm") props.onConfirm?.()
      if (store.active === "cancel") props.onCancel?.()
      dialog.clear()
      return
    }

    if (evt.name === "left" || evt.name === "right") {
      setStore("active", store.active === "confirm" ? "cancel" : "confirm")
    }
  })

  function formatType(type: ErrorDetection.ErrorType) {
    return type.replace(/_/g, " ")
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <box gap={0}>
        <text fg={theme.text}>{props.description}</text>
        <Show when={metaLine().length > 0}>
          <text fg={theme.textMuted}>{metaLine()}</text>
        </Show>
      </box>

      <Show
        when={props.errors.length > 0}
        fallback={<text fg={theme.textMuted}>No heuristic errors detected.</text>}
      >
        <box gap={1}>
          <text fg={theme.textMuted}>Detected issues</text>
          <box
            backgroundColor={theme.backgroundElement}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            maxHeight={10}
          >
            <scrollbox>
              <For each={props.errors}>
                {(err) => (
                  <box flexDirection="row" gap={1} paddingBottom={1}>
                    <text fg={theme.warning}>
                      • {formatType(err.type)}
                    </text>
                    <text fg={theme.textMuted}>({Math.round(err.severity * 100)}%)</text>
                    <text fg={theme.text} wrapMode="word">
                      {Locale.truncate(err.evidence, 140)}
                    </text>
                  </box>
                )}
              </For>
            </scrollbox>
          </box>
        </box>
      </Show>

      <box flexDirection="row" justifyContent="flex-end" paddingTop={1}>
        <For each={["cancel", "confirm"]}>
          {(key) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === store.active ? theme.primary : undefined}
              onMouseUp={() => {
                if (key === "confirm") props.onConfirm?.()
                if (key === "cancel") props.onCancel?.()
                dialog.clear()
              }}
            >
              <text fg={key === store.active ? theme.selectedListItemText : theme.textMuted}>
                {Locale.titlecase(key)}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

DialogTaskOutcome.show = (
  dialog: DialogContext,
  props: Omit<DialogTaskOutcomeProps, "onConfirm" | "onCancel">,
) => {
  return new Promise<boolean>((resolve) => {
    dialog.replace(
      () => (
        <DialogTaskOutcome
          {...props}
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
        />
      ),
      () => resolve(false),
    )
  })
}

