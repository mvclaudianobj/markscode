import { describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { MarkscodePath } from "@/markscode-path"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Database } from "@/storage/db"
import { it } from "../lib/effect"

describe("Database.getChannelPath", () => {
  it.effect("uses markscode data dir under home when XDG_DATA_HOME is absent", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(MarkscodePath.dataDir({ HOME: "/tmp/marks-home" })).toBe(path.join("/tmp/marks-home", ".local", "share", "markscode"))
      expect(path.join(MarkscodePath.dataDir({ HOME: "/tmp/marks-home" }), "markscode.db")).toContain(path.join(".local", "share", "markscode", "markscode.db"))
      expect(Database.getChannelPath(flags)).toBe(path.join(MarkscodePath.dataDir(), "markscode.db"))
    }).pipe(Effect.provide(RuntimeFlags.layer())),
  )

  it.effect("returns database path for the current channel", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(Database.getChannelPath(flags)).toBe(path.join(MarkscodePath.dataDir(), "markscode.db"))
      expect(Database.getChannelPath(flags)).toContain(path.join("share", "markscode", "markscode.db"))
    }).pipe(Effect.provide(RuntimeFlags.layer())),
  )

  it.effect("uses the shared database path when channel databases are disabled", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(Database.getChannelPath(flags)).toBe(path.join(MarkscodePath.dataDir(), "markscode.db"))
    }).pipe(Effect.provide(RuntimeFlags.layer({ disableChannelDb: true }))),
  )

  it.effect("accepts RuntimeFlags with skipMigrations for database callers", () =>
    Effect.gen(function* () {
      const flags = yield* RuntimeFlags.Service

      expect(flags.skipMigrations).toBe(true)
      expect(Database.getChannelPath(flags)).toBe(Database.getChannelPath({ disableChannelDb: flags.disableChannelDb }))
    }).pipe(Effect.provide(RuntimeFlags.layer({ skipMigrations: true }))),
  )
})
