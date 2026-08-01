import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Option, Schema } from "effect"
import { jsonSchema, tool } from "ai"

import { MapGate } from "@/map/gate"
import { MapBinding } from "@/map/binding"
import { MapClient } from "@/map/client"
import { MapShadow } from "@/map/shadow"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, SessionID } from "@/session/schema"
import { SessionTools } from "@/session/tools"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

let calls = 0
let hang = false
let ready: Deferred.Deferred<void> | undefined
const builtin = {
  id: "builtin_test",
  description: "test",
  parameters: Schema.Struct({}),
  execute: () => Effect.succeed({ title: "builtin", metadata: {}, output: "builtin output" }),
}
const mcpTool = tool({
  description: "test",
  inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
  execute: async () => ({ content: [{ type: "text" as const, text: "mcp output" }] }),
})
const layer = Layer.mergeAll(
  Layer.mock(ToolRegistry.Service)({ tools: () => Effect.succeed([builtin]) }),
  Layer.mock(MCP.Service)({ tools: () => Effect.succeed({ mcp_test: mcpTool }) }),
  Layer.mock(Plugin.Service)({ trigger: (_name, _input, output) => Effect.succeed(output) }),
  Layer.mock(Permission.Service)({ ask: () => Effect.void }),
  Layer.mock(Truncate.Service)({ output: (output) => Effect.succeed({ content: output, truncated: false }) }),
  MapGate.layer.pipe(
    Layer.provide(
      Layer.mock(MapShadow.Service)({
        observe: () =>
          Effect.sync(() => {
            calls += 1
          }).pipe(
            Effect.andThen(Effect.suspend(() => (ready ? Deferred.succeed(ready, undefined) : Effect.void))),
            Effect.andThen(Effect.suspend(() => (hang ? Effect.never : Effect.die("shadow unavailable")))),
          ),
      }),
    ),
    Layer.provide(Layer.mock(MapBinding.Service)({ get: () => Effect.succeed(Option.none()) })),
    Layer.provide(Layer.mock(MapClient.Service)({
      authenticated: (use) => use({
        capabilities: () => Effect.die("unused"),
        createEvent: () => Effect.die("unused"),
        events: () => Effect.die("unused"),
        me: () => Effect.die("unused"),
        modules: () => Effect.die("unused"),
        orgs: () => Effect.die("unused"),
        projects: () => Effect.die("unused"),
        tasks: () => Effect.die("unused"),
        updateTask: () => Effect.die("unused"),
      }),
    })),
  ),
)
const it = testEffect(layer)

describe("SessionTools MapGate integration", () => {
  it.instance("built-in and MCP wrappers use the real gate and preserve outputs", () =>
    Effect.gen(function* () {
      calls = 0
      hang = false
      const sessionID = SessionID.descending()
      const tools = yield* SessionTools.resolve({
        agent: { name: "build", mode: "primary", permission: [], options: {} },
        model: {
          id: ModelID.make("test-model"),
          providerID: ProviderID.make("test"),
          name: "Test",
          status: "active",
          headers: {},
          release_date: "2026-01-01",
          api: { id: "test-model", url: "https://example.com", npm: "@ai-sdk/openai" },
          capabilities: {
            toolcall: true,
            attachment: false,
            reasoning: false,
            temperature: true,
            interleaved: false,
            input: { text: true, image: false, audio: false, video: false, pdf: false },
            output: { text: true, image: false, audio: false, video: false, pdf: false },
          },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 1000, output: 1000 },
          options: {},
        },
        session: { id: sessionID, permission: [] } as never,
        processor: {
          message: { id: MessageID.ascending() },
          updateToolCall: () => Effect.void,
          completeToolCall: () => Effect.void,
        } as never,
        bypassAgentCheck: false,
        messages: [],
        promptOps: {} as never,
      })
      const options = { toolCallId: "call", messages: [], abortSignal: new AbortController().signal } as never

      expect(yield* Effect.promise(() => tools.builtin_test.execute!({}, options))).toEqual(
        expect.objectContaining({ title: "builtin", output: "builtin output" }),
      )
      expect(calls).toBe(1)

      hang = true
      const started = yield* Deferred.make<void>()
      ready = started
      const result = yield* Effect.promise(() => tools.mcp_test.execute!({}, options)).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      expect(yield* Fiber.join(result)).toEqual(expect.objectContaining({ output: "mcp output" }))
      expect(calls).toBe(2)
    }),
  )
})
