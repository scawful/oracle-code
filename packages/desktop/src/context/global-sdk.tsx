import { createOracleCodeClient, type Event } from "@oracle-code/sdk/v2/client"
import { createSimpleContext } from "@oracle-code/ui/context"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { onCleanup } from "solid-js"

export const { use: useGlobalSDK, provider: GlobalSDKProvider } = createSimpleContext({
  name: "GlobalSDK",
  init: (props: { url: string }) => {
    const abort = new AbortController()
    const sdk = createOracleCodeClient({
      baseUrl: props.url,
      signal: abort.signal,
    })

    const emitter = createGlobalEmitter<{
      [key: string]: Event
    }>()

    sdk.global.event().then(async (events) => {
      for await (const event of events.stream) {
        // console.log("event", event)
        emitter.emit(event.directory ?? "global", event.payload)
      }
    })

    onCleanup(() => {
      abort.abort()
    })

    return { url: props.url, client: sdk, event: emitter }
  },
})
