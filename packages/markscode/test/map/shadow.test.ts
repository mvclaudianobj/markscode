import { describe, expect } from "bun:test"
import { Cause, DateTime, Effect, Layer, Option } from "effect"
import { eq } from "drizzle-orm"

import { Account } from "@/account/account"
import { AccountStateTable, AccountTable } from "@/account/account.sql"
import { AccessToken, AccountID, OrgID, RefreshToken } from "@/account/schema"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MapBinding } from "@/map/binding"
import { MapSessionBindingTable } from "@/map/binding.sql"
import { MapClient } from "@/map/client"
import { MapShadow } from "@/map/shadow"
import { MapSessionShadowTable } from "@/map/shadow.sql"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { Database } from "@/storage/db"
import { Storage } from "@/storage/storage"
import { SyncEvent } from "@/sync"
import { testEffect } from "../lib/effect"

const accountID = AccountID.make("account-1")
const orgID = OrgID.make("org-1")
const active: Account.ActiveOrg = {
  account: { id: accountID, email: "user@example.com", url: "https://marks.ia.br", active_org_id: orgID },
  org: { id: orgID, name: "Org" },
}
const timestamp = DateTime.makeUnsafe("2026-07-26T00:00:00.000Z")
const common = {
  slug: "slug",
  name: "Name",
  description: null,
  status: "active" as const,
  priority: "normal" as const,
  provenance: "native" as const,
  metadata_json: "{}",
  version: 1,
  created_by: null,
  updated_by: null,
  completed_by: null,
  source_session: null,
  created_at: timestamp,
  updated_at: timestamp,
  completed_at: null,
  deleted_at: null,
}
const project = (input: Partial<MapClient.Project> = {}) =>
  new MapClient.Project({ org_id: orgID, id: "project-1", ...common, ...input })
const module = (input: Partial<MapClient.Module> = {}) =>
  new MapClient.Module({ org_id: orgID, id: "module-1", project_id: "project-1", ...common, ...input })
const task = (input: Partial<MapClient.Task> = {}) =>
  new MapClient.Task({
    org_id: orgID,
    id: "task-1",
    project_id: "project-1",
    module_id: "module-1",
    title: "Task",
    description: null,
    status: "open",
    priority: "normal",
    assignee_id: null,
    due_at: null,
    provenance: "native",
    metadata_json: "{}",
    version: 1,
    created_by: null,
    updated_by: null,
    completed_by: null,
    source_session: null,
    created_at: timestamp,
    updated_at: timestamp,
    completed_at: null,
    deleted_at: null,
    ...input,
  })

const sized = <T extends MapClient.Project | MapClient.Module | MapClient.Task>(value: T, bytes: number) => {
  const base = Buffer.byteLength(JSON.stringify({ ...value, metadata_json: "" }))
  return { ...value, metadata_json: "x".repeat(bytes - base) } as T
}

type Api = {
  projects: () => Effect.Effect<MapClient.ProjectsResponse, MapClient.Error>
  modules: () => Effect.Effect<MapClient.ModulesResponse, MapClient.Error>
  tasks: () => Effect.Effect<MapClient.TasksResponse, MapClient.Error>
}

const authenticated = (configured: Api): MapClient.AuthenticatedInterface => ({
  me: () => Effect.die("unused"),
  orgs: () => Effect.die("unused"),
  capabilities: () => Effect.die("unused"),
  projects: configured.projects,
  modules: configured.modules,
  tasks: configured.tasks,
  events: () => Effect.die("unused"),
  createEvent: () => Effect.die("unused"),
  updateTask: () => Effect.die("unused"),
})

const layers = (api: Api) => {
  const client = Layer.mock(MapClient.Service)({
    authenticated: (use) => use(authenticated(api)),
    projects: api.projects,
    modules: api.modules,
    tasks: api.tasks,
  })
  return Layer.mergeAll(
    MapBinding.layer,
    MapShadow.layer.pipe(Layer.provide(MapBinding.layer), Layer.provide(client)),
    Session.layer.pipe(
      Layer.provide(Bus.layer),
      Layer.provide(Storage.defaultLayer),
      Layer.provide(SyncEvent.defaultLayer),
      Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
      Layer.provide(BackgroundJob.defaultLayer),
    ),
  )
}

const api = (
  input: { projects?: MapClient.Project[]; modules?: MapClient.Module[]; tasks?: MapClient.Task[] } = {},
): Api => ({
  projects: () => Effect.succeed(new MapClient.ProjectsResponse({ items: input.projects ?? [project()] })),
  modules: () => Effect.succeed(new MapClient.ModulesResponse({ items: input.modules ?? [module()] })),
  tasks: () => Effect.succeed(new MapClient.TasksResponse({ items: input.tasks ?? [task()] })),
})

const prepare = Effect.sync(() => {
  Database.use((db) => {
    db.insert(AccountTable)
      .values({
        id: accountID,
        email: active.account.email,
        url: active.account.url,
        access_token: AccessToken.make("token"),
        refresh_token: RefreshToken.make("refresh"),
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .onConflictDoNothing()
      .run()
    db.insert(AccountStateTable)
      .values({ id: 1, active_account_id: accountID, active_org_id: orgID })
      .onConflictDoUpdate({
        target: AccountStateTable.id,
        set: { active_account_id: accountID, active_org_id: orgID },
      })
      .run()
  })
})

describe("MapShadow", () => {
  testEffect(layers(api())).instance("persists exact project-only, module, and task variants", () =>
    Effect.gen(function* () {
      yield* prepare
      const sessions = yield* Session.Service
      const binding = yield* MapBinding.Service
      const shadow = yield* MapShadow.Service
      const projectOnly = yield* sessions.create({})
      const withModule = yield* sessions.create({})
      const withTask = yield* sessions.create({})
      yield* binding.set({ sessionID: projectOnly.id, projectID: "project-1" })
      yield* binding.set({ sessionID: withModule.id, projectID: "project-1", moduleID: "module-1" })
      yield* binding.set({ sessionID: withTask.id, projectID: "project-1", moduleID: "module-1", taskID: "task-1" })

      const values = yield* Effect.all(
        [shadow.observe(projectOnly.id), shadow.observe(withModule.id), shadow.observe(withTask.id)],
        { concurrency: 1 },
      )

      expect(values.map(Option.getOrThrow).map((value) => [value.projectID, value.moduleID, value.taskID])).toEqual([
        ["project-1", undefined, undefined],
        ["project-1", "module-1", undefined],
        ["project-1", "module-1", "task-1"],
      ])
      expect(JSON.parse(Option.getOrThrow(values[2]).taskJson ?? "").id).toBe("task-1")
    }),
  )

  testEffect(Layer.empty).instance("task observation uses one authenticated scope for all reads", () =>
    Effect.gen(function* () {
      let acquisitions = 0
      const configured = api()
      const client = Layer.mock(MapClient.Service)({
        authenticated: (use) => {
          acquisitions += 1
          return use(authenticated(configured))
        },
      })
      const serviceLayer = Layer.mergeAll(
        MapBinding.layer,
        MapShadow.layer.pipe(Layer.provide(MapBinding.layer), Layer.provide(client)),
        Session.layer.pipe(
          Layer.provide(Bus.layer),
          Layer.provide(Storage.defaultLayer),
          Layer.provide(SyncEvent.defaultLayer),
          Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
          Layer.provide(BackgroundJob.defaultLayer),
        ),
      )
      const services = yield* Effect.all([MapShadow.Service, MapBinding.Service, Session.Service]).pipe(
        Effect.provide(serviceLayer),
      )
      yield* prepare
      const info = yield* services[2].create({})
      yield* services[1].set({
        sessionID: info.id,
        projectID: "project-1",
        moduleID: "module-1",
        taskID: "task-1",
      })

      expect(Option.isSome(yield* services[0].observe(info.id))).toBeTrue()
      expect(acquisitions).toBe(1)
    }),
  )

  testEffect(Layer.empty).instance("performs zero HTTP without a binding", () =>
    Effect.gen(function* () {
      let calls = 0
      const service = yield* MapShadow.Service.pipe(
        Effect.provide(
          layers({
            projects: () =>
              Effect.sync(() => {
                calls += 1
                return new MapClient.ProjectsResponse({ items: [] })
              }),
            modules: () => Effect.succeed(new MapClient.ModulesResponse({ items: [] })),
            tasks: () => Effect.succeed(new MapClient.TasksResponse({ items: [] })),
          }),
        ),
      )
      const info = yield* Session.Service.pipe(
        Effect.flatMap((sessions) => sessions.create({})),
        Effect.provide(layers(api())),
      )

      expect(Option.isNone(yield* service.observe(info.id))).toBe(true)
      expect(calls).toBe(0)
    }),
  )

  testEffect(Layer.empty).instance("uses freshness and preserves prior shadow on client error", () =>
    Effect.gen(function* () {
      let calls = 0
      let fail = false
      const configured = api()
      const serviceLayer = layers({
        ...configured,
        projects: () => {
          calls += 1
          return fail
            ? Effect.fail(new MapClient.ResponseError({ operation: "projects", status: 500 }))
            : configured.projects()
        },
      })
      const services = yield* Effect.all([MapShadow.Service, MapBinding.Service, Session.Service]).pipe(
        Effect.provide(serviceLayer),
      )
      yield* prepare
      const info = yield* services[2].create({})
      yield* services[1].set({ sessionID: info.id, projectID: "project-1" })
      const first = Option.getOrThrow(yield* services[0].observe(info.id))
      const fresh = Option.getOrThrow(yield* services[0].observe(info.id))
      expect(fresh).toEqual(first)
      expect(calls).toBe(1)
      Database.use((db) =>
        db
          .update(MapSessionShadowTable)
          .set({ time_observed: 0 })
          .where(eq(MapSessionShadowTable.session_id, info.id))
          .run(),
      )
      fail = true
      const exit = yield* services[0].observe(info.id).pipe(Effect.exit)
      const preserved = Option.getOrThrow(yield* services[0].get(info.id))
      expect(exit._tag).toBe("Failure")
      expect(preserved.projectJson).toBe(first.projectJson)
      expect(preserved.projectVersion).toBe(first.projectVersion)
    }),
  )

  testEffect(Layer.empty).instance("rejects future timestamps and account revision cache mismatches", () =>
    Effect.gen(function* () {
      let calls = 0
      const configured = api()
      const serviceLayer = layers({
        ...configured,
        projects: () =>
          Effect.sync(() => {
            calls += 1
            return new MapClient.ProjectsResponse({ items: [project()] })
          }),
      })
      const services = yield* Effect.all([MapShadow.Service, MapBinding.Service, Session.Service]).pipe(
        Effect.provide(serviceLayer),
      )
      yield* prepare
      const info = yield* services[2].create({})
      yield* services[1].set({ sessionID: info.id, projectID: "project-1" })
      yield* services[0].observe(info.id)
      Database.use((db) =>
        db
          .update(MapSessionShadowTable)
          .set({ time_observed: Date.now() + 60_000 })
          .where(eq(MapSessionShadowTable.session_id, info.id))
          .run(),
      )
      yield* services[0].observe(info.id)
      Database.use((db) => db.run("UPDATE account_state SET revision = revision + 1 WHERE id = 1"))
      yield* services[0].observe(info.id)

      expect(calls).toBe(3)
    }),
  )

  for (const [name, configured, expected] of [
    ["entity boundary", api({ projects: [sized(project(), MapShadow.entityByteLimit)] }), "success"],
    ["entity over", api({ projects: [sized(project(), MapShadow.entityByteLimit + 1)] }), "entity"],
    [
      "total boundary",
      api({
        projects: [sized(project(), MapShadow.entityByteLimit)],
        modules: [sized(module(), MapShadow.entityByteLimit)],
        tasks: [sized(task(), MapShadow.entityByteLimit)],
      }),
      "success",
    ],
    [
      "total over",
      api({
        projects: [sized(project(), MapShadow.entityByteLimit)],
        modules: [sized(module(), MapShadow.entityByteLimit)],
        tasks: [sized(task(), MapShadow.entityByteLimit + 1)],
      }),
      "total",
    ],
  ] as const) {
    testEffect(layers(configured)).instance(`enforces 64KiB and 192KiB ${name}`, () =>
      Effect.gen(function* () {
        yield* prepare
        const sessions = yield* Session.Service
        const binding = yield* MapBinding.Service
        const shadow = yield* MapShadow.Service
        const info = yield* sessions.create({})
        yield* binding.set({ sessionID: info.id, projectID: "project-1", moduleID: "module-1", taskID: "task-1" })
        const exit = yield* shadow.observe(info.id).pipe(Effect.exit)

        if (expected === "success") expect(exit._tag).toBe("Success")
        else expect(exit._tag === "Failure" && Cause.squash(exit.cause)).toMatchObject({ reason: expected })
      }),
    )
  }

  testEffect(Layer.empty).instance("rejects stale CAS, hierarchy, organization, and limits", () =>
    Effect.gen(function* () {
      const run = (configured: Api) =>
        Effect.gen(function* () {
          const serviceLayer = layers(configured)
          const services = yield* Effect.all([MapShadow.Service, MapBinding.Service, Session.Service]).pipe(
            Effect.provide(serviceLayer),
          )
          yield* prepare
          const info = yield* services[2].create({})
          yield* services[1].set({ sessionID: info.id, projectID: "project-1", moduleID: "module-1", taskID: "task-1" })
          return yield* services[0].observe(info.id).pipe(Effect.exit)
        })
      const hierarchy = yield* run(api({ tasks: [task({ project_id: "other" })] }))
      const organization = yield* run(api({ projects: [project({ org_id: "org-2" })] }))
      const limits = yield* run(
        api({ projects: Array.from({ length: 1001 }, (_, index) => project({ id: `project-${index}` })) }),
      )
      const stale = yield* Effect.gen(function* () {
        const configured = api()
        const target: { sessionID?: SessionID } = {}
        const serviceLayer = layers({
          ...configured,
          projects: () =>
            Effect.sync(() => {
              const sessionID = target.sessionID
              if (sessionID)
                Database.use((db) =>
                  db
                    .update(MapSessionBindingTable)
                    .set({ revision: 2 })
                    .where(eq(MapSessionBindingTable.session_id, sessionID))
                    .run(),
                )
              return new MapClient.ProjectsResponse({ items: [project()] })
            }),
        })
        const services = yield* Effect.all([MapShadow.Service, MapBinding.Service, Session.Service]).pipe(
          Effect.provide(serviceLayer),
        )
        yield* prepare
        const info = yield* services[2].create({})
        yield* services[1].set({ sessionID: info.id, projectID: "project-1", moduleID: "module-1", taskID: "task-1" })
        target.sessionID = info.id
        return yield* services[0].observe(info.id)
      })
      const aba = yield* Effect.gen(function* () {
        const configured = api()
        const serviceLayer = layers({
          ...configured,
          projects: () =>
            Effect.sync(() => {
              Database.use((db) => {
                db.run("UPDATE account_state SET active_org_id = 'org-2', revision = revision + 1 WHERE id = 1")
                db.run("UPDATE account_state SET active_org_id = 'org-1', revision = revision + 1 WHERE id = 1")
              })
              return new MapClient.ProjectsResponse({ items: [project()] })
            }),
        })
        const services = yield* Effect.all([MapShadow.Service, MapBinding.Service, Session.Service]).pipe(
          Effect.provide(serviceLayer),
        )
        yield* prepare
        const info = yield* services[2].create({})
        yield* services[1].set({ sessionID: info.id, projectID: "project-1", moduleID: "module-1", taskID: "task-1" })
        return yield* services[0].observe(info.id)
      })

      expect([hierarchy, organization, limits].map((exit) => exit._tag)).toEqual(["Failure", "Failure", "Failure"])
      expect(Option.isNone(stale)).toBe(true)
      expect(Option.isNone(aba)).toBe(true)
    }),
  )

  testEffect(layers(api())).instance("cascades with the binding", () =>
    Effect.gen(function* () {
      yield* prepare
      const sessions = yield* Session.Service
      const binding = yield* MapBinding.Service
      const shadow = yield* MapShadow.Service
      const info = yield* sessions.create({})
      yield* binding.set({ sessionID: info.id, projectID: "project-1" })
      yield* shadow.observe(info.id)

      yield* binding.remove(info.id)

      expect(Option.isNone(yield* shadow.get(info.id))).toBe(true)
    }),
  )

  testEffect(layers(api())).instance("detects account ABA and cascades on account removal", () =>
    Effect.gen(function* () {
      yield* prepare
      const sessions = yield* Session.Service
      const binding = yield* MapBinding.Service
      const shadow = yield* MapShadow.Service
      const info = yield* sessions.create({})
      yield* binding.set({ sessionID: info.id, projectID: "project-1" })
      yield* shadow.observe(info.id)
      Database.use((db) => db.delete(AccountTable).where(eq(AccountTable.id, accountID)).run())

      expect(Option.isNone(yield* shadow.get(info.id))).toBeTrue()
    }),
  )
})
