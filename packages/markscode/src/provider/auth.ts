import type { AuthOAuthResult, Hooks } from "@opencode-ai/plugin"
import { Auth } from "@/auth"
import { InstanceState } from "@/effect/instance-state"
import { zod } from "@/util/effect-zod"
import { namedSchemaError } from "@/util/named-schema-error"
import { withStatics } from "@/util/schema"
import { Plugin } from "../plugin"
import { ProviderID } from "./schema"
import { Array as Arr, Effect, Layer, Record, Result, Context, Schema } from "effect"

const fixAnthropicOAuth = (providerID: ProviderID, url: string) => {
  if (providerID !== "anthropic") return url

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return url
  }

  const isClaudeOauth =
    (parsed.hostname === "claude.ai" && parsed.pathname === "/oauth/authorize") ||
    (parsed.hostname === "claude.com" && parsed.pathname === "/cai/oauth/authorize")

  if (!isClaudeOauth) return url

  parsed.hostname = "claude.com"
  parsed.pathname = "/cai/oauth/authorize"
  parsed.searchParams.set("redirect_uri", "https://platform.claude.com/oauth/code/callback")

  const required = [
    "org:create_api_key",
    "user:profile",
    "user:inference",
    "user:sessions:claude_code",
    "user:mcp_servers",
    "user:file_upload",
  ]

  const current = (parsed.searchParams.get("scope") || "")
    .split(" ")
    .map((x) => x.trim())
    .filter(Boolean)

  const merged = Array.from(new Set([...current, ...required]))
  parsed.searchParams.set("scope", merged.join(" "))
  return parsed.toString()
}

const normalizeAuthCode = (providerID: ProviderID, code?: string) => {
  if (!code) return code
  const raw = code.trim()
  if (!raw) return raw
  if (providerID !== "anthropic") return raw

  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const parsed = new URL(raw)
      const fromQuery = parsed.searchParams.get("code")
      if (fromQuery) return fromQuery

      const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash
      if (hash.includes("code=")) {
        const params = new URLSearchParams(hash)
        const fromHash = params.get("code")
        if (fromHash) return fromHash
      }
    } catch {
      return raw
    }
  }

  if (raw.includes("#")) return raw.split("#")[0]
  return raw
}

const When = Schema.Struct({
  key: Schema.String,
  op: Schema.Literals(["eq", "neq"]),
  value: Schema.String,
})

const TextPrompt = Schema.Struct({
  type: Schema.Literal("text"),
  key: Schema.String,
  message: Schema.String,
  placeholder: Schema.optional(Schema.String),
  when: Schema.optional(When),
})

const SelectOption = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  hint: Schema.optional(Schema.String),
})

const SelectPrompt = Schema.Struct({
  type: Schema.Literal("select"),
  key: Schema.String,
  message: Schema.String,
  options: Schema.Array(SelectOption),
  when: Schema.optional(When),
})

const Prompt = Schema.Union([TextPrompt, SelectPrompt])

export class Method extends Schema.Class<Method>("ProviderAuthMethod")({
  type: Schema.Literals(["oauth", "api"]),
  label: Schema.String,
  prompts: Schema.optional(Schema.Array(Prompt)),
}) {
  static readonly zod = zod(this)
}

export const Methods = Schema.Record(Schema.String, Schema.Array(Method)).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Methods = typeof Methods.Type

export class Authorization extends Schema.Class<Authorization>("ProviderAuthAuthorization")({
  url: Schema.String,
  method: Schema.Literals(["auto", "code"]),
  instructions: Schema.String,
}) {
  static readonly zod = zod(this)
}

export const AuthorizeInput = Schema.Struct({
  method: Schema.Number.annotate({ description: "Auth method index" }),
  inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({ description: "Prompt inputs" }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type AuthorizeInput = Schema.Schema.Type<typeof AuthorizeInput>

export const CallbackInput = Schema.Struct({
  method: Schema.Number.annotate({ description: "Auth method index" }),
  code: Schema.optional(Schema.String).annotate({ description: "OAuth authorization code" }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type CallbackInput = Schema.Schema.Type<typeof CallbackInput>

export const OauthMissing = namedSchemaError("ProviderAuthOauthMissing", { providerID: ProviderID })

export const OauthCodeMissing = namedSchemaError("ProviderAuthOauthCodeMissing", { providerID: ProviderID })

export const OauthCallbackFailed = namedSchemaError("ProviderAuthOauthCallbackFailed", {})

export const ValidationFailed = namedSchemaError("ProviderAuthValidationFailed", {
  field: Schema.String,
  message: Schema.String,
})

export type Error =
  | Auth.AuthError
  | InstanceType<typeof OauthMissing>
  | InstanceType<typeof OauthCodeMissing>
  | InstanceType<typeof OauthCallbackFailed>
  | InstanceType<typeof ValidationFailed>

type Hook = NonNullable<Hooks["auth"]>

export interface Interface {
  readonly methods: () => Effect.Effect<Methods>
  readonly authorize: (
    input: {
      providerID: ProviderID
    } & AuthorizeInput,
  ) => Effect.Effect<Authorization | undefined, Error>
  readonly callback: (input: { providerID: ProviderID } & CallbackInput) => Effect.Effect<void, Error>
}

interface State {
  hooks: Record<ProviderID, Hook>
  pending: Map<ProviderID, AuthOAuthResult>
}

export class Service extends Context.Service<Service, Interface>()("@markscode/ProviderAuth") {}

export const layer: Layer.Layer<Service, never, Auth.Service | Plugin.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const plugin = yield* Plugin.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("ProviderAuth.state")(function* () {
        const plugins = yield* plugin.list()
        return {
          hooks: Record.fromEntries(
            Arr.filterMap(plugins, (x) =>
              x.auth?.provider !== undefined
                ? Result.succeed([ProviderID.make(x.auth.provider), x.auth] as const)
                : Result.failVoid,
            ),
          ),
          pending: new Map<ProviderID, AuthOAuthResult>(),
        }
      }),
    )

    const decode = Schema.decodeUnknownSync(Methods)
    const methods = Effect.fn("ProviderAuth.methods")(function* () {
      const hooks = (yield* InstanceState.get(state)).hooks
      return decode(
        Record.map(hooks, (item) =>
          item.methods.map((method) => ({
            type: method.type,
            label: method.label,
            prompts: method.prompts?.map((prompt) => {
              if (prompt.type === "select") {
                return {
                  type: "select" as const,
                  key: prompt.key,
                  message: prompt.message,
                  options: prompt.options,
                  when: prompt.when,
                }
              }
              return {
                type: "text" as const,
                key: prompt.key,
                message: prompt.message,
                placeholder: prompt.placeholder,
                when: prompt.when,
              }
            }),
          })),
        ),
      )
    })

    const authorize = Effect.fn("ProviderAuth.authorize")(function* (
      input: { providerID: ProviderID } & AuthorizeInput,
    ) {
      const { hooks, pending } = yield* InstanceState.get(state)
      const method = hooks[input.providerID].methods[input.method]
      if (method.type !== "oauth") return

      if (method.prompts && input.inputs) {
        for (const prompt of method.prompts) {
          if (prompt.type === "text" && prompt.validate && input.inputs[prompt.key] !== undefined) {
            const error = prompt.validate(input.inputs[prompt.key])
            if (error) return yield* Effect.fail(new ValidationFailed({ field: prompt.key, message: error }))
          }
        }
      }

      const result = yield* Effect.promise(() => method.authorize(input.inputs))
      pending.set(input.providerID, result)
      return {
        url: result.url,
        method: result.method,
        instructions: result.instructions,
      }
    })

    const callback = Effect.fn("ProviderAuth.callback")(function* (input: { providerID: ProviderID } & CallbackInput) {
      const pending = (yield* InstanceState.get(state)).pending
      const match = pending.get(input.providerID)
      if (!match) return yield* Effect.fail(new OauthMissing({ providerID: input.providerID }))
      if (match.method === "code" && !input.code) {
        return yield* Effect.fail(new OauthCodeMissing({ providerID: input.providerID }))
      }

      const result = yield* Effect.promise(() =>
        match.method === "code" ? match.callback(input.code!) : match.callback(),
      )
      if (!result || result.type !== "success") return yield* Effect.fail(new OauthCallbackFailed({}))

      if ("key" in result) {
        yield* auth.set(input.providerID, {
          type: "api",
          key: result.key,
        })
      }

      if ("refresh" in result) {
        const { type: _, provider: __, refresh, access, expires, ...extra } = result
        yield* auth.set(input.providerID, {
          type: "oauth",
          access,
          refresh,
          expires,
          ...extra,
        })
      }
    })

    return Service.of({ methods, authorize, callback })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(Auth.defaultLayer), Layer.provide(Plugin.defaultLayer)),
)

export * as ProviderAuth from "./auth"
