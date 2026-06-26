import os from "os"
import path from "path"

export function dataDir(env: NodeJS.ProcessEnv = process.env) {
  return path.join(env.XDG_DATA_HOME || path.join(env.OPENCODE_TEST_HOME || env.HOME || os.homedir(), ".local/share"), "markscode")
}

export function stateDir(env: NodeJS.ProcessEnv = process.env) {
  return path.join(env.XDG_STATE_HOME || path.join(env.OPENCODE_TEST_HOME || env.HOME || os.homedir(), ".local/state"), "markscode")
}

export * as MarkscodePath from "./markscode-path"
