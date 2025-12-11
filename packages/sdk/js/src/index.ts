export * from "./client.js"
export * from "./server.js"

import { createOracleCodeClient } from "./client.js"
import { createOracleCodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createOracleCode(options?: ServerOptions) {
  const server = await createOracleCodeServer({
    ...options,
  })

  const client = createOracleCodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
