import { Router } from "@solidjs/router"
import { FileRoutes } from "@solidjs/start/router"
import { Font } from "@oracle-code/ui/font"
import { MetaProvider } from "@solidjs/meta"
import { MarkedProvider } from "@oracle-code/ui/context/marked"
import { Suspense } from "solid-js"
import "./app.css"
import { Favicon } from "@oracle-code/ui/favicon"

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <MarkedProvider>
            <Favicon />
            <Font />
            <Suspense>{props.children}</Suspense>
          </MarkedProvider>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  )
}
