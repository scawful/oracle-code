export namespace Flag {
  export const OCODE_AUTO_SHARE = truthy("OCODE_AUTO_SHARE")
  export const OCODE_CONFIG = process.env["OCODE_CONFIG"]
  export const OCODE_CONFIG_DIR = process.env["OCODE_CONFIG_DIR"]
  export const OCODE_CONFIG_CONTENT = process.env["OCODE_CONFIG_CONTENT"]
  export const OCODE_DISABLE_AUTOUPDATE = truthy("OCODE_DISABLE_AUTOUPDATE")
  export const OCODE_DISABLE_PRUNE = truthy("OCODE_DISABLE_PRUNE")
  export const OCODE_PERMISSION = process.env["OCODE_PERMISSION"]
  export const OCODE_DISABLE_DEFAULT_PLUGINS = truthy("OCODE_DISABLE_DEFAULT_PLUGINS")
  export const OCODE_DISABLE_LSP_DOWNLOAD = truthy("OCODE_DISABLE_LSP_DOWNLOAD")
  export const OCODE_ENABLE_EXPERIMENTAL_MODELS = truthy("OCODE_ENABLE_EXPERIMENTAL_MODELS")
  export const OCODE_DISABLE_AUTOCOMPACT = truthy("OCODE_DISABLE_AUTOCOMPACT")
  export const OCODE_FAKE_VCS = process.env["OCODE_FAKE_VCS"]
  // Feature Flags
  export const OCODE_EXPERIMENTAL = truthy("OCODE_EXPERIMENTAL")
  export const OCODE_EXPERIMENTAL_ICON_DISCOVERY =
    OCODE_EXPERIMENTAL || truthy("OCODE_EXPERIMENTAL_ICON_DISCOVERY")
  export const OCODE_EXPERIMENTAL_WATCHER = OCODE_EXPERIMENTAL || truthy("OCODE_EXPERIMENTAL_WATCHER")
  export const OCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT = truthy("OCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const OCODE_ENABLE_EXA =
    truthy("OCODE_ENABLE_EXA") || OCODE_EXPERIMENTAL || truthy("OCODE_EXPERIMENTAL_EXA")
  export const OCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH = number("OCODE_EXPERIMENTAL_BASH_MAX_OUTPUT_LENGTH")
  export const OCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("OCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")

  function truthy(key: string) {
    const value = process.env[key]?.toLowerCase()
    return value === "true" || value === "1"
  }

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}
