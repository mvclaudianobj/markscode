import { Context, Effect, Layer } from "effect"
import PROMPT_FIXED from "./prompt/default.txt"
import fs from "node:fs"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"

import { InstanceState } from "@/effect/instance-state"
import { getMarksAgentString } from "@/marks-agent-config-source"

import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"

declare global {
  var __MARKSCODE_ACCOUNT_NAME__: string | undefined
}

const globalPromptUserName = globalThis as typeof globalThis & { __MARKSCODE_ACCOUNT_NAME__?: string }

const DEFAULT_PROMPT_USER_NAME = "Senhor Marcos"
const USER_NAME_PATTERN = /(?:(ao|do|o) )?Senhor Marcos/g
const PROMPT_USER_NAME_PLACEHOLDER = "{{MARKSCODE_PROMPT_USER_NAME}}"
const PROMPT_USER_NAME_KEYS = [
  "MARKSCODE_ACCOUNT_NAME",
  "MARKSCODE_PROFILE_NAME",
  "MARKSCODE_USER_NAME",
  "MARKSCODE_PREFERRED_NAME",
  "MARKS_ACCOUNT_NAME",
  "MARKS_USER_NAME",
] as const
const RUNTIME_PROMPT_USER_NAME_KEY = "MARKSCODE_RUNTIME_PROMPT_USER_NAME"
const PROMPT_USER_NAME_STATE_FILE = "prompt-user-name.json"
let storedPromptUserNameCache: { path: string; mtimeMs: number; name?: string } | undefined

export function sanitizePromptUserName(name?: string) {
  return name?.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80) || undefined
}

export function resolveConfiguredPromptUserName() {
  return PROMPT_USER_NAME_KEYS.map((key) => sanitizePromptUserName(getMarksAgentString(key) || process.env[key])).find(Boolean)
}

export function isPreferredNamePromptPending(input: { configured?: string; stored?: string; dismissed?: boolean }) {
  return !sanitizePromptUserName(input.configured) && !sanitizePromptUserName(input.stored) && !input.dismissed
}

export function setPromptUserName(name?: string) {
  const sanitized = sanitizePromptUserName(name)
  globalPromptUserName.__MARKSCODE_ACCOUNT_NAME__ = sanitized
  if (sanitized) {
    process.env[RUNTIME_PROMPT_USER_NAME_KEY] = sanitized
    return
  }
  delete process.env[RUNTIME_PROMPT_USER_NAME_KEY]
}

export function promptUserNameStatePath() {
  return path.join(Global.Path.state, PROMPT_USER_NAME_STATE_FILE)
}

export async function savePromptUserName(name?: string) {
  const sanitized = sanitizePromptUserName(name)
  if (!sanitized) return undefined
  fs.mkdirSync(Global.Path.state, { recursive: true })
  fs.writeFileSync(promptUserNameStatePath(), JSON.stringify({ name: sanitized }))
  setPromptUserName(sanitized)
  storedPromptUserNameCache = { path: promptUserNameStatePath(), mtimeMs: fs.statSync(promptUserNameStatePath()).mtimeMs, name: sanitized }
  return sanitized
}

export function loadStoredPromptUserName() {
  try {
    if (!fs.existsSync(promptUserNameStatePath())) return undefined
    const stat = fs.statSync(promptUserNameStatePath())
    if (storedPromptUserNameCache?.path === promptUserNameStatePath() && storedPromptUserNameCache.mtimeMs === stat.mtimeMs) {
      return storedPromptUserNameCache.name
    }
    const data = JSON.parse(fs.readFileSync(promptUserNameStatePath(), "utf8"))
    const name = sanitizePromptUserName(typeof data?.name === "string" ? data.name : undefined)
    storedPromptUserNameCache = { path: promptUserNameStatePath(), mtimeMs: stat.mtimeMs, name }
    return name
  } catch {
    return undefined
  }
}

export function resolvePromptUserName(name?: string) {
  return (
    resolveConfiguredPromptUserName() ||
    sanitizePromptUserName(process.env[RUNTIME_PROMPT_USER_NAME_KEY]) ||
    sanitizePromptUserName(globalPromptUserName.__MARKSCODE_ACCOUNT_NAME__) ||
    loadStoredPromptUserName() ||
    sanitizePromptUserName(name) ||
    DEFAULT_PROMPT_USER_NAME
  )
}

export function applyPromptUserName(prompt: string, userName: string) {
  const sanitized = sanitizePromptUserName(userName) || DEFAULT_PROMPT_USER_NAME
  const rendered = prompt
    .replaceAll(PROMPT_USER_NAME_PLACEHOLDER, sanitized)
    .replace(USER_NAME_PATTERN, (match, article: string | undefined) => article ? `${article} ${sanitized}` : sanitized)
  if (sanitized === DEFAULT_PROMPT_USER_NAME) return rendered
  return [`Nome/tratamento atual do usuário: ${sanitized}. Use exclusivamente este nome/tratamento ao se referir ao usuário.`, rendered].join("\n")
}

export function fixed() {
  return applyPromptUserName(PROMPT_FIXED.trim(), resolvePromptUserName())
}

export function provider(model: Provider.Model) {
  return [fixed()]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => Effect.Effect<string[]>
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
        const ctx = yield* InstanceState.context
        return [
          [
            `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
            `Here is some useful information about the environment you are running in:`,
            `<env>`,
            `  Working directory: ${ctx.directory}`,
            `  Workspace root folder: ${ctx.worktree}`,
            `  Is directory a git repo: ${ctx.project.vcs === "git" ? "yes" : "no"}`,
            `  Platform: ${process.platform}`,
            `  Today's date: ${new Date().toDateString()}`,
            `</env>`,
          ].join("\n"),
        ]
      }),

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const list = yield* skill.available(agent)

        return [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          // the agents seem to ingest the information about skills a bit better if we present a more verbose
          // version of them here and a less verbose version in tool description, rather than vice versa.
          Skill.fmt(list, { verbose: true }),
        ].join("\n")
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
