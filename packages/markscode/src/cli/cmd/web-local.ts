import fs from "fs"
import path from "path"
import { spawn } from "child_process"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { Global } from "../../global"

const state = path.join(Global.Path.state, "web-local")
const backendPid = path.join(state, "backend.pid")
const frontendPid = path.join(state, "frontend.pid")
const backendLog = path.join(state, "backend.log")
const frontendLog = path.join(state, "frontend.log")

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const readPid = (file: string) => {
  try {
    const raw = fs.readFileSync(file, "utf8").trim()
    if (!raw) return 0
    const pid = Number.parseInt(raw, 10)
    if (!Number.isFinite(pid) || pid <= 0) return 0
    return pid
  } catch {
    return 0
  }
}

const start = (cmd: string, args: string[], cwd: string, logFile: string) => {
  const out = fs.openSync(logFile, "a")
  const child = spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  })
  child.unref()
  return child.pid
}

export const WebLocalCommand = cmd({
  command: "web-local",
  describe: "start web-local services (frontend 8889 + backend 8989)",
  handler: async () => {
    fs.mkdirSync(state, { recursive: true })

    const be = readPid(backendPid)
    if (be && isAlive(be)) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "Backend already running on pid " + String(be))
    } else {
      const pid = start(process.execPath, ["serve", "--hostname", "127.0.0.1", "--port", "8989"], process.cwd(), backendLog)
      fs.writeFileSync(backendPid, String(pid))
    }

    const root = process.cwd()
    const app = [
      path.join(root, "packages/app"),
      path.join(root, "markscode/packages/app"),
      process.env.MARKSCODE_REPO ? path.join(process.env.MARKSCODE_REPO, "packages/app") : "",
    ].find((x) => x && fs.existsSync(x))
    if (!app) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "packages/app not found. Frontend not started.")
      UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + "Run from repo root or set MARKSCODE_REPO=/path/to/markscode")
      UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + "Use MARKSCODE_WEB_APP_URL to point to hosted frontend.")
      return
    }

    const fe = readPid(frontendPid)
    if (fe && isAlive(fe)) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  " + "Frontend already running on pid " + String(fe))
    } else {
      const env = {
        ...process.env,
        VITE_OPENCODE_SERVER_HOST: "127.0.0.1",
        VITE_OPENCODE_SERVER_PORT: "8989",
      }
      const out = fs.openSync(frontendLog, "a")
      const child = spawn("bun", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "8889"], {
        cwd: app,
        detached: true,
        stdio: ["ignore", out, out],
        env,
      })
      child.unref()
      fs.writeFileSync(frontendPid, String(child.pid))
    }

    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "✓  " + "Web local initialized")
    UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + "Frontend: http://127.0.0.1:8889")
    UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + "Gateway:  http://127.0.0.1:8989")
  },
})
