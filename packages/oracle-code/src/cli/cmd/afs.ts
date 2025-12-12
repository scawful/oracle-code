import { Global } from "@/global"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import { AFS } from "../../afs"
import path from "path"
import fs from "fs/promises"
import { EOL } from "os"

const AFS_DIRS = {
  memory: { policy: "read_only", desc: "Long-term specs and architectural decisions" },
  knowledge: { policy: "read_only", desc: "Immutable reference materials" },
  tools: { policy: "executable", desc: "Scripts and automation tools" },
  scratchpad: { policy: "writable", desc: "Transient working memory and plans" },
  history: { policy: "read_only", desc: "Archived sessions" },
}

const AfsInitCommand = cmd({
  command: "init",
  describe: "initialize agentic file system",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        const root = path.join(Instance.directory, ".context")
        UI.println(`Initializing AFS in ${root}`)

        for (const [name, info] of Object.entries(AFS_DIRS)) {
          const dir = path.join(root, name)
          await fs.mkdir(dir, { recursive: true })
          UI.println(`  + created ${name} (${info.policy})`)
        }

        // Create AFS_SPEC.md if it doesn't exist
        const specPath = path.join(root, "memory", "AFS_SPEC.md")
        if (!(await Bun.file(specPath).exists())) {
          await Bun.write(
            specPath,
            `# Agentic File System Spec\n\n${Object.entries(AFS_DIRS)
              .map(([k, v]) => `- **/${k}**: ${v.desc} (${v.policy})`)
              .join("\n")}`,
          )
          UI.println(`  + created memory/AFS_SPEC.md`)
        }

        UI.println(`${EOL}${UI.Style.TEXT_SUCCESS_BOLD}AFS Initialized.${UI.Style.TEXT_NORMAL}`)
      },
    })
  },
})

const AfsStatusCommand = cmd({
  command: "status",
  describe: "show AFS status",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        const status = await AFS.getStatus()

        if (!status.exists) {
          UI.error(`AFS not initialized. Run 'ocode afs init' to create .context directory.`)
          return
        }

        UI.println(`${UI.Style.TEXT_HIGHLIGHT_BOLD}Agentic File System${UI.Style.TEXT_NORMAL} (${status.root})`)
        for (const dir of status.directories) {
          const color =
            dir.policy === "read_only"
              ? UI.Style.TEXT_DIM
              : dir.policy === "writable"
                ? UI.Style.TEXT_SUCCESS
                : UI.Style.TEXT_WARNING

          UI.println(
            `  ${color}${dir.name.padEnd(12)}${UI.Style.TEXT_NORMAL} [${dir.policy}] - ${dir.fileCount} items`,
          )
        }
      },
    })
  },
})

export const AfsCommand = cmd({
  command: "afs",
  describe: "manage Agentic File System",
  builder: (yargs) => yargs.command(AfsInitCommand).command(AfsStatusCommand).demandCommand(),
  async handler() {},
})
