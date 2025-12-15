import { createSignal, For, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useAFS } from "../context/afs"
import { Emotions } from "@/cognitive"

type EmotionCategory = "fear" | "curiosity" | "satisfaction" | "frustration"

const CATEGORIES: { id: EmotionCategory; label: string; icon: string; color: "error" | "info" | "success" | "warning" }[] = [
  { id: "fear", label: "Fear", icon: "!", color: "error" },
  { id: "curiosity", label: "Curiosity", icon: "?", color: "info" },
  { id: "satisfaction", label: "Satisfaction", icon: "+", color: "success" },
  { id: "frustration", label: "Frustration", icon: "-", color: "warning" },
]

const INTENSITIES = [
  { value: 3, label: "Low" },
  { value: 5, label: "Medium" },
  { value: 7, label: "High" },
  { value: 9, label: "Critical" },
]

interface DialogEmotionRecordProps {
  /** Pre-selected category */
  category?: EmotionCategory
  /** Callback on successful recording */
  onRecord?: (emotion: { category: EmotionCategory; trigger: string; intensity: number }) => void
}

/**
 * Emotion Recording Dialog
 * 
 * Allows user to record an emotion with category, description, and intensity.
 * 
 * Keyboard shortcuts:
 * - 1-4: Select category
 * - Tab: Move to next field
 * - Enter: Submit (when in description field)
 * - Esc: Cancel
 */
export function DialogEmotionRecord(props: DialogEmotionRecordProps) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const afs = useAFS()

  const [category, setCategory] = createSignal<EmotionCategory | null>(props.category || null)
  const [intensity, setIntensity] = createSignal(5)
  const [step, setStep] = createSignal<"category" | "description" | "intensity">(
    props.category ? "description" : "category"
  )

  let textarea: TextareaRenderable

  onMount(() => {
    if (step() === "description") {
      setTimeout(() => textarea?.focus(), 10)
    }
  })

  async function submit() {
    const cat = category()
    if (!cat) {
      toast.show({ message: "Select a category first", variant: "warning", duration: 1500 })
      return
    }

    const trigger = textarea?.plainText?.trim()
    if (!trigger) {
      toast.show({ message: "Enter a description", variant: "warning", duration: 1500 })
      return
    }

    try {
      // Use afs.root from context for proper path resolution
      const root = afs.root
      if (!root) {
        toast.show({ message: "AFS not initialized", variant: "error", duration: 2000 })
        return
      }

      await Emotions.addEmotion(root, cat, trigger, "User recorded", intensity())
      
      props.onRecord?.({ category: cat, trigger, intensity: intensity() })
      toast.show({ 
        message: `Recorded ${cat}: "${trigger.slice(0, 30)}${trigger.length > 30 ? "..." : ""}"`, 
        variant: "success", 
        duration: 2000 
      })
      dialog.clear()
    } catch (e) {
      toast.show({ message: "Failed to record emotion", variant: "error", duration: 2000 })
    }
  }

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return

    if (step() === "category") {
      const num = parseInt(evt.name)
      if (num >= 1 && num <= 4) {
        setCategory(CATEGORIES[num - 1].id)
        setStep("description")
        setTimeout(() => textarea?.focus(), 10)
        return
      }
    }

    if (step() === "intensity") {
      const num = parseInt(evt.name)
      if (num >= 1 && num <= 4) {
        setIntensity(INTENSITIES[num - 1].value)
        submit()
        return
      }
    }

    if (evt.name === "tab" && step() === "description") {
      evt.preventDefault()
      setStep("intensity")
    }
  })

  const getCategoryColor = (cat: typeof CATEGORIES[0]) => {
    switch (cat.color) {
      case "error": return theme.error
      case "info": return theme.info
      case "success": return theme.success
      case "warning": return theme.warning
      default: return theme.text
    }
  }

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      {/* Header */}
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Record Emotion
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      {/* Category selection */}
      <Show when={step() === "category"}>
        <box marginTop={1}>
          <text fg={theme.textMuted}>Select category (1-4):</text>
        </box>
        <box marginTop={1}>
          <For each={CATEGORIES}>
            {(cat, index) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>
                  <b>{index() + 1}</b>
                </text>
                <text fg={getCategoryColor(cat)}>
                  [{cat.icon}] {cat.label}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* Description input */}
      <Show when={step() === "description" || step() === "intensity"}>
        <box marginTop={1} flexDirection="row" gap={1}>
          <text fg={theme.textMuted}>Category:</text>
          <text fg={getCategoryColor(CATEGORIES.find(c => c.id === category())!)}>
            [{CATEGORIES.find(c => c.id === category())?.icon}] {CATEGORIES.find(c => c.id === category())?.label}
          </text>
        </box>

        <box marginTop={1}>
          <text fg={theme.textMuted}>Description (what triggered this):</text>
        </box>
        <textarea
          ref={(val: TextareaRenderable) => (textarea = val)}
          height={3}
          onSubmit={() => {
            if (step() === "description") {
              setStep("intensity")
            }
          }}
          keyBindings={[{ name: "return", action: "submit" }]}
          placeholder="Describe what caused this emotion..."
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </Show>

      {/* Intensity selection */}
      <Show when={step() === "intensity"}>
        <box marginTop={1}>
          <text fg={theme.textMuted}>Select intensity (1-4):</text>
        </box>
        <box marginTop={1}>
          <For each={INTENSITIES}>
            {(int, index) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>
                  <b>{index() + 1}</b>
                </text>
                <text fg={intensity() === int.value ? theme.primary : theme.textMuted}>
                  {int.label} ({int.value}/10)
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* Footer hints */}
      <box marginTop={1} flexDirection="row" gap={2}>
        <Show when={step() === "description"}>
          <text fg={theme.text}>
            <b>Tab</b> <span style={{ fg: theme.textMuted }}>next</span>
          </text>
          <text fg={theme.text}>
            <b>Enter</b> <span style={{ fg: theme.textMuted }}>continue</span>
          </text>
        </Show>
        <Show when={step() === "intensity"}>
          <text fg={theme.text}>
            <b>1-4</b> <span style={{ fg: theme.textMuted }}>select and submit</span>
          </text>
        </Show>
      </box>
    </box>
  )
}

/**
 * Static helper to show the dialog
 */
DialogEmotionRecord.show = (
  dialog: DialogContext, 
  options?: { category?: EmotionCategory }
): Promise<{ category: EmotionCategory; trigger: string; intensity: number } | null> => {
  return new Promise((resolve) => {
    dialog.replace(
      () => (
        <DialogEmotionRecord
          category={options?.category}
          onRecord={(emotion) => resolve(emotion)}
        />
      ),
      () => resolve(null),
    )
  })
}

/**
 * Quick emotion buttons for sidebar/footer
 */
export function QuickEmotionButtons() {
  const { theme } = useTheme()
  const dialog = useDialog()

  return (
    <box flexDirection="row" gap={1}>
      <For each={CATEGORIES}>
        {(cat) => {
          const color = () => {
            switch (cat.color) {
              case "error": return theme.error
              case "info": return theme.info
              case "success": return theme.success
              case "warning": return theme.warning
              default: return theme.text
            }
          }
          return (
            <text
              fg={color()}
              onMouseDown={() => {
                DialogEmotionRecord.show(dialog, { category: cat.id })
              }}
            >
              [{cat.icon}]
            </text>
          )
        }}
      </For>
    </box>
  )
}
