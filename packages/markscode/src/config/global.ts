export * as ConfigGlobal from "./global"

import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { parse as parseJsonc, type ParseError as JsoncParseError } from "jsonc-parser"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { Filesystem } from "@/util/filesystem"
import { isRecord } from "@/util/record"
import { parsePluginSpecifier } from "@/plugin/shared"

const log = Log.create({ service: "config.global" })
const MARKSCODE_NOTIFIER_PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../vendor/markscode-notifier")

export const DEFAULT_MARKSCODE_PLUGINS = [
  "@tarquinen/opencode-dcp@latest",
  MARKSCODE_NOTIFIER_PLUGIN,
  "opencode-supermemory@latest",
] as const

export function markscodeGlobalConfigDir(env: NodeJS.ProcessEnv = process.env) {
  return path.join(env.XDG_CONFIG_HOME || path.join(env.HOME || os.homedir(), ".config"), "markscode")
}

function pluginSpec(item: unknown) {
  if (typeof item === "string") return item
  if (!Array.isArray(item)) return
  if (typeof item[0] !== "string") return
  return item[0]
}

function pluginPackage(spec: string) {
  if (spec.startsWith("file://")) return spec
  return parsePluginSpecifier(spec).pkg
}

export async function ensureDefaultPlugins(env: NodeJS.ProcessEnv = process.env) {
  if (Flag.OPENCODE_PURE || env.OPENCODE_PURE === "1" || env.OPENCODE_PURE === "true") return
  const file = path.join(markscodeGlobalConfigDir(env), "markscode.json")
  const exists = await Filesystem.exists(file)
  if (!exists) {
    await Filesystem.write(file, JSON.stringify({ plugin: DEFAULT_MARKSCODE_PLUGINS }, null, 2))
    return
  }

  const text = await Filesystem.readText(file)
  const errors: JsoncParseError[] = []
  const data = parseJsonc(text, errors, { allowTrailingComma: true })
  if (errors.length || !isRecord(data)) {
    log.warn("skipping default plugin bootstrap due to invalid markscode global config", { path: file })
    return
  }

  const list = Array.isArray(data.plugin) ? data.plugin : []
  const packages = new Set(list.map(pluginSpec).filter((item): item is string => Boolean(item)).map(pluginPackage))
  const missing = DEFAULT_MARKSCODE_PLUGINS.filter((spec) => !packages.has(pluginPackage(spec)))
  if (!missing.length && Array.isArray(data.plugin)) return

  await Filesystem.write(file, JSON.stringify({ ...data, plugin: [...list, ...missing] }, null, 2))
}
