import { Global } from "@/global"
import { EOL } from "os"
import { Config } from "../../../config/config"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const ConfigCommand = cmd({
  command: "config",
  builder: (yargs) => yargs,
  async handler() {
    await bootstrap(Global.cwd(), async () => {
      const config = await Config.get()
      process.stdout.write(JSON.stringify(config, null, 2) + EOL)
    })
  },
})
