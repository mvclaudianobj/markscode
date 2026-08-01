import { describe, expect } from "bun:test"
import { DateTime, Deferred, Effect, Fiber, Layer, Option } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

import { Account } from "@/account/account"
import { AccountStateTable, AccountTable } from "@/account/account.sql"
import { AccessToken, AccountID, OrgID, RefreshToken } from "@/account/schema"
import { BackgroundJob } from "@/background/job"
import { Bus } from "@/bus"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MapBinding } from "@/map/binding"
import { MapGate } from "@/map/gate"
import { MapSessionShadowTable } from "@/map/shadow.sql"
import { Session } from "@/session/session"
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
const timestamp = DateTime.formatIso(DateTime.makeUnsafe("2026-07-26T00:00:00.000Z"))
const common = {
  slug: "slug",
  name: "Name",
  description: null,
  status: "active",
  priority: "normal",
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
}
const account = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.some(active.account)),
  activeOrg: () => Effect.succeed(Option.some(active)),
  token: () => Effect.succeed(Option.some(AccessToken.make("token"))),
  acquireActiveOrgLease: () =>
    Effect.succeed(Option.some({ active, accessToken: AccessToken.make("token"), revision: 1 })),
  validateActiveOrgLease: () => Effect.succeed(true),
})
const session = Session.layer.pipe(
  Layer.provide(Bus.layer),
  Layer.provide(Storage.defaultLayer),
  Layer.provide(SyncEvent.defaultLayer),
  Layer.provide(RuntimeFlags.layer({ experimentalWorkspaces: false })),
  Layer.provide(BackgroundJob.defaultLayer),
)
const response = (request: HttpClientRequest.HttpClientRequest, body: unknown) =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }),
  )

describe("MapGate composition", () => {
  testEffect(Layer.empty).instance("resolves live graph, persists freshness, and cancels timed out HTTP", () =>
    Effect.gen(function* () {
      const seen: string[] = []
      const requested = yield* Deferred.make<void>()
      const cancelled = yield* Deferred.make<void>()
      let hang = false
      const http = HttpClient.make((request) => {
        seen.push(new URL(request.url).pathname)
        if (hang) {
          return Deferred.succeed(requested, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined)),
          )
        }
        if (request.url.includes("/projects")) {
          return Effect.succeed(response(request, { items: [{ org_id: orgID, id: "project-1", ...common }] }))
        }
        if (request.url.includes("/modules")) {
          return Effect.succeed(
            response(request, { items: [{ org_id: orgID, id: "module-1", project_id: "project-1", ...common }] }),
          )
        }
        return Effect.succeed(
          response(request, {
            items: [
              {
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
              },
            ],
          }),
        )
      })
      const layers = Layer.mergeAll(MapGate.liveLayer, MapBinding.layer, session).pipe(
        Layer.provide(account),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
      )
      const services = yield* Effect.all([MapGate.Service, MapBinding.Service, Session.Service]).pipe(
        Effect.provide(layers),
      )
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
      const persisted = yield* services[2].create({})
      yield* services[1].set({
        sessionID: persisted.id,
        projectID: "project-1",
        moduleID: "module-1",
        taskID: "task-1",
      })

      yield* services[0].prompt(persisted.id)
      expect(seen).toEqual(["/api/map/v3/projects", "/api/map/v3/modules", "/api/map/v3/tasks"])
      expect(
        Database.use((db) =>
          db
            .select()
            .from(MapSessionShadowTable)
            .where(Database.eq(MapSessionShadowTable.session_id, persisted.id))
            .get(),
        ),
      ).toMatchObject({ project_id: "project-1", module_id: "module-1", task_id: "task-1" })

      seen.length = 0
      yield* services[0].tool({ sessionID: persisted.id, tool: "read", source: "builtin" })
      expect(seen).toEqual([])

      const timed = yield* services[2].create({})
      yield* services[1].set({ sessionID: timed.id, projectID: "project-1" })
      hang = true
      const fiber = yield* services[0].prompt(timed.id).pipe(Effect.forkChild)
      yield* Deferred.await(requested)
      expect(yield* Fiber.join(fiber)).toBeUndefined()
      expect(yield* Deferred.isDone(cancelled)).toBe(true)
    }),
  )
})
