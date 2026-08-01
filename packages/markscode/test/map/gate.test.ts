import { describe, expect } from "bun:test"
import { Cause, Deferred, Effect, Fiber, Layer, Option } from "effect"
import * as TestClock from "effect/testing/TestClock"

import { MapGate } from "@/map/gate"
import { MapBinding } from "@/map/binding"
import { MapClient } from "@/map/client"
import { MapShadow } from "@/map/shadow"
import { SessionID } from "@/session/schema"
import { testEffect } from "../lib/effect"

const sessionID = SessionID.make("ses_00000000000000000000000000")
const error = new MapShadow.ValidationError({ reason: "project" })
const gate = (observe: MapShadow.Interface["observe"]) =>
  MapGate.layer.pipe(
    Layer.provide(Layer.mock(MapShadow.Service)({ observe })),
    Layer.provide(Layer.mock(MapBinding.Service)({
      get: () => Effect.succeed(Option.some({
        sessionID,
        projectID: "project-1",
        taskID: "task-1",
        revision: 1,
        timeCreated: 1,
        timeUpdated: 1,
      })),
    })),
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
  )

describe("MapGate", () => {
  testEffect(gate(() => Effect.succeed(Option.none()))).effect("prompt succeeds", () =>
    Effect.gen(function* () {
      const service = yield* MapGate.Service
      expect(yield* service.prompt(sessionID)).toBeUndefined()
    }),
  )

  testEffect(gate(() => Effect.fail(error))).effect("typed failure fails open", () =>
    Effect.gen(function* () {
      const service = yield* MapGate.Service
      expect(yield* service.tool({ sessionID, tool: "read", source: "builtin" })).toBeUndefined()
    }),
  )

  testEffect(gate(() => Effect.die("shadow unavailable"))).effect("defect fails open", () =>
    Effect.gen(function* () {
      const service = yield* MapGate.Service
      expect(yield* service.tool({ sessionID, tool: "server_action", source: "mcp" })).toBeUndefined()
    }),
  )

  testEffect(Layer.empty).effect("total deadline cancels observation and fails open", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const cancelled = yield* Deferred.make<void>()
      const service = yield* MapGate.Service.pipe(
        Effect.provide(
          gate(() =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined)),
            ),
          ),
        ),
      )
      const fiber = yield* service.prompt(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(started)
      yield* TestClock.adjust("2 seconds")

      expect(yield* Fiber.join(fiber)).toBeUndefined()
      expect(yield* Deferred.isDone(cancelled)).toBe(true)
    }),
  )

  testEffect(Layer.empty).effect("external interruption remains interrupted", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const service = yield* MapGate.Service.pipe(
        Effect.provide(gate(() => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))),
      )
      const fiber = yield* service.prompt(sessionID).pipe(Effect.forkChild)
      yield* Deferred.await(started)

      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    }),
  )

  testEffect(Layer.empty).effect("progress writes event and task update fail open", () =>
    Effect.gen(function* () {
      const calls: string[] = []
      const service = yield* MapGate.Service.pipe(
        Effect.provide(
          MapGate.layer.pipe(
            Layer.provide(Layer.mock(MapShadow.Service)({ observe: () => Effect.succeed(Option.none()) })),
            Layer.provide(Layer.mock(MapBinding.Service)({
              get: () => Effect.succeed(Option.some({
                sessionID,
                projectID: "project-1",
                taskID: "task-1",
                revision: 1,
                timeCreated: 1,
                timeUpdated: 1,
              })),
            })),
            Layer.provide(Layer.mock(MapClient.Service)({
              authenticated: (use) => use({
                capabilities: () => Effect.die("unused"),
                createEvent: (input) => Effect.sync(() => {
                  calls.push(`event:${input.event_type}:${input.aggregate_id}`)
                  return {} as MapClient.Event
                }),
                events: () => Effect.die("unused"),
                me: () => Effect.die("unused"),
                modules: () => Effect.die("unused"),
                orgs: () => Effect.die("unused"),
                projects: () => Effect.die("unused"),
                tasks: () => Effect.die("unused"),
                updateTask: (taskID, input) => Effect.sync(() => {
                  calls.push(`task:${taskID}:${input.status}`)
                  return {} as MapClient.Task
                }),
              }),
            })),
          ),
        ),
      )
      expect(yield* service.progress({ sessionID, status: "in_progress", event: "prompt.completed" })).toBeUndefined()
      expect(calls).toEqual(["event:prompt.completed:task-1", "task:task-1:in_progress"])
    }),
  )
})
