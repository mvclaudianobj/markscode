import { describe, expect, spyOn } from "bun:test"
import { Effect, Fiber, Layer, Option } from "effect"
import { eq } from "drizzle-orm"

import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MapBinding } from "@/map/binding"
import { MapSessionBindingTable } from "@/map/binding.sql"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import { Database } from "@/storage/db"
import { SyncEvent } from "@/sync"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    MapBinding.layer,
    Session.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
  ),
)

describe("MapBinding", () => {
  it.instance("roundtrips a session binding", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const binding = yield* MapBinding.Service
      const info = yield* session.create({})

      const saved = yield* binding.set({
        sessionID: info.id,
        projectID: "project-1",
        projectSlug: "project-one",
        moduleID: "module-1",
        moduleSlug: "module-one",
        taskID: "task-1",
        taskTitle: "Task one",
      })
      const loaded = yield* binding.get(info.id)

      expect(Option.getOrThrow(loaded)).toEqual(saved)
      expect(saved.sessionID).toBe(info.id)
      expect(saved.taskID).toBe("task-1")
      expect(saved.revision).toBe(1)
    }),
  )

  it.instance("increments revision for updates in the same millisecond", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const binding = yield* MapBinding.Service
      const info = yield* session.create({})
      using now = spyOn(Date, "now").mockReturnValue(1)
      const first = yield* binding.set({ sessionID: info.id, projectID: "project-1" })
      const second = yield* binding.set({ sessionID: info.id, projectID: "project-2" })

      expect(second.timeUpdated).toBe(first.timeUpdated)
      expect(second.revision).toBe(first.revision + 1)
    }),
  )

  it.instance("returns unique revisions for concurrent updates in the same millisecond", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const binding = yield* MapBinding.Service
      const info = yield* session.create({})
      using now = spyOn(Date, "now").mockReturnValue(1)
      const fibers = yield* Effect.forEach(
        Array.from({ length: 8 }, (_, index) => index),
        (index) => binding.set({ sessionID: info.id, projectID: `project-${index}` }).pipe(Effect.forkChild),
      )
      const values = yield* Effect.forEach(fibers, Fiber.join)

      expect(values.map((value) => value.revision).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
      expect(values.every((value) => value.timeUpdated === 1)).toBeTrue()
    }),
  )

  it.instance("cascades deletion from session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const binding = yield* MapBinding.Service
      const info = yield* session.create({})
      yield* binding.set({ sessionID: info.id, projectID: "project-cascade" })

      yield* session.remove(info.id)

      expect(Option.isNone(yield* binding.get(info.id))).toBe(true)
    }),
  )

  it.instance("does not inherit binding when session is forked", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const binding = yield* MapBinding.Service
      const original = yield* session.create({})
      yield* binding.set({ sessionID: original.id, projectID: "project-fork" })

      const forked = yield* session.fork({ sessionID: original.id })

      expect(Option.isSome(yield* binding.get(original.id))).toBe(true)
      expect(Option.isNone(yield* binding.get(forked.id))).toBe(true)
    }),
  )

  it.live("enforces the session foreign key", () =>
    Effect.gen(function* () {
      const binding = yield* MapBinding.Service
      const missing = "ses_00000000000000000000000000" as Parameters<typeof binding.get>[0]

      const exit = yield* binding.set({ sessionID: missing, projectID: "project-missing" }).pipe(Effect.exit)

      expect(exit._tag).toBe("Failure")
      expect(Option.isNone(yield* binding.get(missing))).toBe(true)
    }),
  )
})
