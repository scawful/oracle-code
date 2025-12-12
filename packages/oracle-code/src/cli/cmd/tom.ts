import { Global } from "@/global"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Instance } from "../../project/instance"
import path from "path"

const TomSyncCommand = cmd({
  command: "sync",
  describe: "sync common ground",
  async handler() {
    await Instance.provide({
      directory: Global.cwd(),
      async fn() {
        const memoryPath = path.join(Instance.worktree, ".context/memory/AGENTS_SPEC.md")
        const exists = await Bun.file(memoryPath).exists()

        if (exists) {
            UI.println(`${UI.Style.TEXT_SUCCESS}Common Ground established.${UI.Style.TEXT_NORMAL} Swarm is aligned.`)
        } else {
            UI.println(`${UI.Style.TEXT_WARNING}Common Ground missing.${UI.Style.TEXT_NORMAL} Run 'ocode afs init' first.`)
        }
      },
    })
  },
})

export const TomCommand = cmd({
  command: "tom",
  describe: "theory of mind tools",
  builder: (yargs) => yargs.command(TomSyncCommand).demandCommand(),
  async handler() {},
})
