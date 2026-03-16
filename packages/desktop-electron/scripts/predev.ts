import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

const RUST_TARGET = Bun.env.RUST_TARGET

const sidecarConfig = getCurrentSidecar(RUST_TARGET)\n\nconst dist = sidecarConfig.ocBinary.replace(/^opencode-/, "markscode-")\nconst binaryPath = windowsify(`../markscode/dist/${dist}/bin/markscode`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../markscode && bun run build --single --baseline`
  : $`cd ../markscode && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath)
