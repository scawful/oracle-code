import { cmd } from "./cmd"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { MCP } from "../../mcp"
import { McpAuth } from "../../mcp/auth"
import { Config } from "../../config/config"
import { Instance } from "../../project/instance"
import path from "path"
import os from "os"
import { Global } from "../../global"
import fs from "fs/promises"
import { type ParseError as JsoncParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser"

function displayPath(filePath: string) {
  const home = os.homedir()
  return filePath.startsWith(home) ? filePath.replace(home, "~") : filePath
}

function splitCommandLine(input: string): string[] {
  const out: string[] = []
  let current = ""
  let quote: "'" | "\"" | null = null
  let escaped = false

  const push = () => {
    const trimmed = current.trim()
    if (trimmed.length > 0) out.push(trimmed)
    current = ""
  }

  for (const ch of input) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === "\\" && quote !== "'") {
      escaped = true
      continue
    }

    if (quote) {
      if (ch === quote) {
        quote = null
        continue
      }
      current += ch
      continue
    }

    if (ch === "'" || ch === "\"") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      push()
      continue
    }

    current += ch
  }

  if (escaped) current += "\\"
  push()
  return out
}

async function readJsoncFile(filePath: string): Promise<Record<string, any>> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) return {}

  const contents = await file.text()
  const errors: JsoncParseError[] = []
  const data = parseJsonc(contents, errors, { allowTrailingComma: true }) as any
  if (errors.length > 0) {
    const first = errors[0]!
    const code = printParseErrorCode(first.error)
    throw new Error(`Invalid config at ${filePath} (${code} @ ${first.offset})`)
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {}
  return data
}

async function writeJsonFile(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, JSON.stringify(data, null, 2) + "\n")
}

async function chooseConfigTarget() {
  const projectDir = path.join(Instance.worktree, ".oracle-code")
  const globalDir = Global.Path.config

  const projectJsonc = path.join(projectDir, "oracle-code.jsonc")
  const projectJson = path.join(projectDir, "oracle-code.json")
  const globalJsonc = path.join(globalDir, "oracle-code.jsonc")
  const globalJson = path.join(globalDir, "oracle-code.json")

  const pickExistingOrDefault = async (jsoncPath: string, jsonPath: string) => {
    if (await Bun.file(jsoncPath).exists()) return jsoncPath
    if (await Bun.file(jsonPath).exists()) return jsonPath
    return jsonPath
  }

  const projectTarget = await pickExistingOrDefault(projectJsonc, projectJson)
  const globalTarget = await pickExistingOrDefault(globalJsonc, globalJson)

  const selected = await prompts.select({
    message: "Save MCP config to",
    options: [
      { label: "Project", value: "project", hint: displayPath(projectTarget) },
      { label: "Global", value: "global", hint: displayPath(globalTarget) },
    ],
  })
  if (prompts.isCancel(selected)) throw new UI.CancelledError()

  return selected === "project" ? projectTarget : globalTarget
}

export const McpCommand = cmd({
  command: "mcp",
  builder: (yargs) =>
    yargs
      .command(McpAddCommand)
      .command(McpListCommand)
      .command(McpAuthCommand)
      .command(McpLogoutCommand)
      .demandCommand(),
  async handler() {},
})

export const McpListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list MCP servers and their status",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP Servers")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}
        const statuses = await MCP.status()

        if (Object.keys(mcpServers).length === 0) {
          prompts.log.warn("No MCP servers configured")
          prompts.outro("Add servers with: ocode mcp add")
          return
        }

        for (const [name, serverConfig] of Object.entries(mcpServers)) {
          const status = statuses[name]
          const hasOAuth = serverConfig.type === "remote" && !!serverConfig.oauth
          const hasStoredTokens = await MCP.hasStoredTokens(name)

          let statusIcon: string
          let statusText: string
          let hint = ""

          if (!status) {
            statusIcon = "○"
            statusText = "not initialized"
          } else if (status.status === "connected") {
            statusIcon = "✓"
            statusText = "connected"
            if (hasOAuth && hasStoredTokens) {
              hint = " (OAuth)"
            }
          } else if (status.status === "disabled") {
            statusIcon = "○"
            statusText = "disabled"
          } else if (status.status === "needs_auth") {
            statusIcon = "⚠"
            statusText = "needs authentication"
          } else if (status.status === "needs_client_registration") {
            statusIcon = "✗"
            statusText = "needs client registration"
            hint = "\n    " + status.error
          } else {
            statusIcon = "✗"
            statusText = "failed"
            hint = "\n    " + status.error
          }

          const typeHint = serverConfig.type === "remote" ? serverConfig.url : serverConfig.command.join(" ")
          prompts.log.info(
            `${statusIcon} ${name} ${UI.Style.TEXT_DIM}${statusText}${hint}\n    ${UI.Style.TEXT_DIM}${typeHint}`,
          )
        }

        prompts.outro(`${Object.keys(mcpServers).length} server(s)`)
      },
    })
  },
})

export const McpAuthCommand = cmd({
  command: "auth [name]",
  describe: "authenticate with an OAuth-enabled MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Authentication")

        const config = await Config.get()
        const mcpServers = config.mcp ?? {}

        // Get OAuth-enabled servers
        const oauthServers = Object.entries(mcpServers).filter(([_, cfg]) => cfg.type === "remote" && !!cfg.oauth)

        if (oauthServers.length === 0) {
          prompts.log.warn("No OAuth-enabled MCP servers configured")
          prompts.log.info("Add OAuth config to a remote MCP server in oracle-code.json (or oracle-code.jsonc):")
          prompts.log.info(`
  "mcp": {
    "my-server": {
      "type": "remote",
      "url": "https://example.com/mcp",
      "oauth": {
        "scope": "tools:read"
      }
    }
  }`)
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          const selected = await prompts.select({
            message: "Select MCP server to authenticate",
            options: oauthServers.map(([name, cfg]) => ({
              label: name,
              value: name,
              hint: cfg.type === "remote" ? cfg.url : undefined,
            })),
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        const serverConfig = mcpServers[serverName]
        if (!serverConfig) {
          prompts.log.error(`MCP server not found: ${serverName}`)
          prompts.outro("Done")
          return
        }

        if (serverConfig.type !== "remote" || !serverConfig.oauth) {
          prompts.log.error(`MCP server ${serverName} does not have OAuth configured`)
          prompts.outro("Done")
          return
        }

        // Check if already authenticated
        const hasTokens = await MCP.hasStoredTokens(serverName)
        if (hasTokens) {
          const confirm = await prompts.confirm({
            message: `${serverName} already has stored credentials. Re-authenticate?`,
          })
          if (prompts.isCancel(confirm) || !confirm) {
            prompts.outro("Cancelled")
            return
          }
        }

        const spinner = prompts.spinner()
        spinner.start("Starting OAuth flow...")

        try {
          const status = await MCP.authenticate(serverName)

          if (status.status === "connected") {
            spinner.stop("Authentication successful!")
          } else if (status.status === "needs_client_registration") {
            spinner.stop("Authentication failed", 1)
            prompts.log.error(status.error)
            prompts.log.info("Add clientId to your MCP server config:")
            prompts.log.info(`
  "mcp": {
    "${serverName}": {
      "type": "remote",
      "url": "${serverConfig.url}",
      "oauth": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret"
      }
    }
  }`)
          } else if (status.status === "failed") {
            spinner.stop("Authentication failed", 1)
            prompts.log.error(status.error)
          } else {
            spinner.stop("Unexpected status: " + status.status, 1)
          }
        } catch (error) {
          spinner.stop("Authentication failed", 1)
          prompts.log.error(error instanceof Error ? error.message : String(error))
        }

        prompts.outro("Done")
      },
    })
  },
})

export const McpLogoutCommand = cmd({
  command: "logout [name]",
  describe: "remove OAuth credentials for an MCP server",
  builder: (yargs) =>
    yargs.positional("name", {
      describe: "name of the MCP server",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("MCP OAuth Logout")

        const authPath = path.join(Global.Path.data, "mcp-auth.json")
        const credentials = await McpAuth.all()
        const serverNames = Object.keys(credentials)

        if (serverNames.length === 0) {
          prompts.log.warn("No MCP OAuth credentials stored")
          prompts.outro("Done")
          return
        }

        let serverName = args.name
        if (!serverName) {
          const selected = await prompts.select({
            message: "Select MCP server to logout",
            options: serverNames.map((name) => {
              const entry = credentials[name]
              const hasTokens = !!entry.tokens
              const hasClient = !!entry.clientInfo
              let hint = ""
              if (hasTokens && hasClient) hint = "tokens + client"
              else if (hasTokens) hint = "tokens"
              else if (hasClient) hint = "client registration"
              return {
                label: name,
                value: name,
                hint,
              }
            }),
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          serverName = selected
        }

        if (!credentials[serverName]) {
          prompts.log.error(`No credentials found for: ${serverName}`)
          prompts.outro("Done")
          return
        }

        await MCP.removeAuth(serverName)
        prompts.log.success(`Removed OAuth credentials for ${serverName}`)
        prompts.outro("Done")
      },
    })
  },
})

export const McpAddCommand = cmd({
  command: "add",
  describe: "add an MCP server",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add MCP server")

        const configPath = await chooseConfigTarget()
        const configData = await readJsoncFile(configPath)
        configData.mcp ??= {}

        const name = await prompts.text({
          message: "Enter MCP server name",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(name)) throw new UI.CancelledError()

        if (configData.mcp[name]) {
          const overwrite = await prompts.confirm({
            message: `MCP server "${name}" already exists in ${displayPath(configPath)}. Overwrite?`,
            initialValue: false,
          })
          if (prompts.isCancel(overwrite) || !overwrite) {
            prompts.outro("Cancelled")
            return
          }
        }

        const type = await prompts.select({
          message: "Select MCP server type",
          options: [
            {
              label: "Local",
              value: "local",
              hint: "Run a local command",
            },
            {
              label: "Remote",
              value: "remote",
              hint: "Connect to a remote URL",
            },
          ],
        })
        if (prompts.isCancel(type)) throw new UI.CancelledError()

        if (type === "local") {
          const command = await prompts.text({
            message: "Enter command to run",
            placeholder: "e.g., bunx @modelcontextprotocol/server-filesystem",
            validate: (x) => (x && x.length > 0 ? undefined : "Required"),
          })
          if (prompts.isCancel(command)) throw new UI.CancelledError()

          const commandParts = splitCommandLine(command)
          if (commandParts.length === 0) {
            prompts.log.error("Invalid command")
            prompts.outro("Done")
            return
          }

          configData.mcp[name] = {
            type: "local",
            command: commandParts,
          }

          await writeJsonFile(configPath, configData)
          prompts.log.success(`Saved ${name} to ${displayPath(configPath)}`)
          prompts.outro("Done")
          return
        }

        if (type === "remote") {
          const url = await prompts.text({
            message: "Enter MCP server URL",
            placeholder: "e.g., https://example.com/mcp",
            validate: (x) => {
              if (!x) return "Required"
              if (x.length === 0) return "Required"
              const isValid = URL.canParse(x)
              return isValid ? undefined : "Invalid URL"
            },
          })
          if (prompts.isCancel(url)) throw new UI.CancelledError()

          const useOAuth = await prompts.confirm({
            message: "Does this server require OAuth authentication?",
            initialValue: false,
          })
          if (prompts.isCancel(useOAuth)) throw new UI.CancelledError()

          if (useOAuth) {
            const hasClientId = await prompts.confirm({
              message: "Do you have a pre-registered client ID?",
              initialValue: false,
            })
            if (prompts.isCancel(hasClientId)) throw new UI.CancelledError()

            if (hasClientId) {
              const clientId = await prompts.text({
                message: "Enter client ID",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(clientId)) throw new UI.CancelledError()

              const hasSecret = await prompts.confirm({
                message: "Do you have a client secret?",
                initialValue: false,
              })
              if (prompts.isCancel(hasSecret)) throw new UI.CancelledError()

              let clientSecret: string | undefined
              if (hasSecret) {
                const secret = await prompts.password({
                  message: "Enter client secret",
                })
                if (prompts.isCancel(secret)) throw new UI.CancelledError()
                clientSecret = secret
              }

              configData.mcp[name] = {
                type: "remote",
                url,
                oauth: {
                  clientId,
                  ...(clientSecret ? { clientSecret } : {}),
                },
              }
            } else {
              configData.mcp[name] = {
                type: "remote",
                url,
                oauth: {},
              }
            }

            await writeJsonFile(configPath, configData)
            prompts.log.success(`Saved ${name} to ${displayPath(configPath)}`)
            prompts.log.info(`Run: ocode mcp auth ${name}`)
            prompts.outro("Done")
            return
          }

          // Non-OAuth remote server: verify connectivity before saving.
          const spinner = prompts.spinner()
          spinner.start("Connecting…")
          try {
            const client = new Client({
              name: "oracle-code",
              version: "1.0.0",
            })
            const transport = new StreamableHTTPClientTransport(new URL(url))
            await client.connect(transport)
            await client.close().catch(() => {})
            spinner.stop("Connected")
          } catch (e) {
            spinner.stop("Failed to connect", 1)
            prompts.log.error(e instanceof Error ? e.message : String(e))
            prompts.outro("Done")
            return
          }

          configData.mcp[name] = {
            type: "remote",
            url,
          }

          await writeJsonFile(configPath, configData)
          prompts.log.success(`Saved ${name} to ${displayPath(configPath)}`)
          prompts.outro("Done")
          return
        }

        prompts.outro("Done")
      },
    })
  },
})
