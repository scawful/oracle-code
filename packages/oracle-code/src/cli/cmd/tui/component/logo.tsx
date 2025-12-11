import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"

const LOGO = [
  `░█▀█░█▀▄░█▀█░█▀▀░█░░░█▀▀░░█▀▀░█▀█░█▀▄░█▀▀`,
  `░█░█░█▀▄░█▀█░█░░░█░░░█▀▀░░█░░░█░█░█░█░█▀▀`,
  `░▀▀▀░▀░▀░▀░▀░▀▀▀░▀▀▀░▀▀▀░░▀▀▀░▀▀▀░▀▀░░▀▀▀`,
]

export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      {LOGO.map((line, index) => (
        <text
          fg={index === 2 ? theme.text : theme.textMuted}
          attributes={index === 2 ? TextAttributes.BOLD : undefined}
        >
          {line}
        </text>
      ))}
    </box>
  )
}
