import fs from "fs"
import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"

const state = path.join(Global.Path.state, "web-local")
const backendPid = path.join(state, "backend.pid")
const frontendPid = path.join(state, "frontend.pid")

const readPid = (file: string) => {
  try {
    const raw = fs.readFileSync(file, "utf8").trim()
    const pid = Number.parseInt(raw, 10)
    if (!Number.isFinite(pid) || pid <= 0) return 0
    return pid
  } catch {
    return 0
  }
}

const stop = (pid: number) => {
  try {
    process.kill(pid)
    return true
  } catch {
    return false
  }
}

export const WebLocalStopCommand = cmd({
  command: "web-local-stop",
  describe: "stop web-local services (frontend 8889 + backend 8989)",
  handler: async () => {
    let stopped = false
    const be = readPid(backendPid)
    if (be && stop(be)) stopped = true
    const fe = readPid(frontendPid)
    if (fe && stop(fe)) stopped = true
    try {
      fs.rmSync(backendPid, { force: true })
      fs.rmSync(frontendPid, { force: true })
    } catch {}

    if (stopped) {
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓  " + "Web local stopped")
      return
    }
    UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "No active web-local processes found")
  },
})
