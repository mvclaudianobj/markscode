import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Context, Effect, Layer, Option, Schedule, Schema } from "effect"
import stripAnsi from "strip-ansi"
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from "effect/unstable/http"

import { Account } from "@/account/account"
import { getMarksAgentString } from "../marks-agent-config-source"
const defaultBaseUrl = "https://map.marks.ia.br/api/map/v3"
const userAgent = "markscode/1.1.0"
const ID = Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(128)))
const NullableID = Schema.NullOr(ID)
const NullableString = Schema.NullOr(Schema.String)
const JsonString = Schema.String
const Timestamp = Schema.DateTimeUtcFromString
const NullableTimestamp = Schema.NullOr(Timestamp)
const Version = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))
const ProjectStatus = Schema.Literals(["draft", "active", "on_hold", "completed", "archived", "cancelled"])
const TaskStatus = Schema.Literals([
  "todo",
  "open",
  "in_progress",
  "blocked",
  "done",
  "completed",
  "cancelled",
  "archived",
])
const Priority = Schema.Literals(["none", "low", "normal", "high", "urgent", "critical"])
const Provenance = Schema.Literals(["native", "manual", "imported", "claimed", "integration"])
const ErrorBody = Schema.Struct({ error: Schema.String, message: Schema.String })
const safeDetail = (value: string) =>
  stripAnsi(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .slice(0, 512)

export class IdentityUser extends Schema.Class<IdentityUser>("MapIdentityUser")({
  id: ID,
  email: Schema.String,
  name: Schema.String,
}) {}

export class IdentityOrganization extends Schema.Class<IdentityOrganization>("MapIdentityOrganization")({
  id: ID,
  name: Schema.String,
}) {}

export class HealthResponse extends Schema.Class<HealthResponse>("MapHealthResponse")({
  status: Schema.Literal("ok"),
  service: Schema.Literal("map"),
  version: Schema.Literal("v3"),
}) {}

export class MeResponse extends Schema.Class<MeResponse>("MapMeResponse")({
  user: IdentityUser,
  organization: IdentityOrganization,
}) {}

export const OrgsResponse = Schema.Array(IdentityOrganization)
export type OrgsResponse = Schema.Schema.Type<typeof OrgsResponse>

export class CapabilitiesResponse extends Schema.Class<CapabilitiesResponse>("MapCapabilitiesResponse")({
  version: Schema.Literal("v3"),
  organization_id: ID,
  reads: Schema.Tuple([
    Schema.Literal("projects"),
    Schema.Literal("modules"),
    Schema.Literal("tasks"),
    Schema.Literal("events"),
  ]),
  writes: Schema.Boolean,
}) {}

const CommonItem = {
  slug: Schema.String,
  name: Schema.String,
  description: NullableString,
  status: ProjectStatus,
  priority: Priority,
  provenance: Provenance,
  metadata_json: JsonString,
  version: Version,
  created_by: NullableID,
  updated_by: NullableID,
  completed_by: NullableID,
  source_session: NullableID,
  created_at: Timestamp,
  updated_at: Timestamp,
  completed_at: NullableTimestamp,
  deleted_at: NullableTimestamp,
}

export class Project extends Schema.Class<Project>("MapProject")({
  org_id: ID,
  id: ID,
  ...CommonItem,
}) {}

export class Module extends Schema.Class<Module>("MapModule")({
  org_id: ID,
  id: ID,
  project_id: ID,
  ...CommonItem,
}) {}

export class Task extends Schema.Class<Task>("MapTask")({
  org_id: ID,
  id: ID,
  project_id: ID,
  module_id: NullableID,
  title: Schema.String,
  description: NullableString,
  status: TaskStatus,
  priority: Priority,
  assignee_id: NullableID,
  due_at: NullableTimestamp,
  provenance: Provenance,
  metadata_json: JsonString,
  version: Version,
  created_by: NullableID,
  updated_by: NullableID,
  completed_by: NullableID,
  source_session: NullableID,
  created_at: Timestamp,
  updated_at: Timestamp,
  completed_at: NullableTimestamp,
  deleted_at: NullableTimestamp,
}) {}

export class Event extends Schema.Class<Event>("MapEvent")({
  org_id: ID,
  id: ID,
  event_type: Schema.String,
  aggregate_type: Schema.String,
  aggregate_id: ID,
  user_id: NullableID,
  source_session: NullableID,
  idempotency_key: NullableString,
  payload_json: JsonString,
  provenance: Provenance,
  version: Version,
  created_at: Timestamp,
}) {}

export class ProjectsResponse extends Schema.Class<ProjectsResponse>("MapProjectsResponse")({
  items: Schema.Array(Project),
}) {}
export class ModulesResponse extends Schema.Class<ModulesResponse>("MapModulesResponse")({
  items: Schema.Array(Module),
}) {}
export class TasksResponse extends Schema.Class<TasksResponse>("MapTasksResponse")({ items: Schema.Array(Task) }) {}
export class EventsResponse extends Schema.Class<EventsResponse>("MapEventsResponse")({ items: Schema.Array(Event) }) {}

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()("MapUnavailableError", {
  operation: Schema.String,
  reason: Schema.Literals(["not_logged", "no_org", "no_token", "org_changed", "unsafe_base"]),
}) {}

export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()("MapUnauthorizedError", {
  operation: Schema.String,
  status: Schema.Literals([401, 403]),
  code: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {}

export class ResponseError extends Schema.TaggedErrorClass<ResponseError>()("MapResponseError", {
  operation: Schema.String,
  status: Schema.Number,
  code: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
}) {}

export class TransportError extends Schema.TaggedErrorClass<TransportError>()("MapTransportError", {
  operation: Schema.String,
}) {}

export class DecodeError extends Schema.TaggedErrorClass<DecodeError>()("MapDecodeError", {
  operation: Schema.String,
}) {}

export type Error = UnavailableError | UnauthorizedError | ResponseError | TransportError | DecodeError
export type ModulesFilter = { project_id?: string }
export type TasksFilter = { project_id?: string; module_id?: string }
export type EventsFilter = { task_id?: string }
export type CreateEventInput = {
  event_type: string
  aggregate_type: string
  aggregate_id: string
  source_session?: string
  idempotency_key?: string
  payload_json?: string
}
export type UpdateTaskInput = {
  status?: "todo" | "open" | "in_progress" | "blocked" | "done" | "completed" | "cancelled" | "archived"
  title?: string
  description?: string
  priority?: "none" | "low" | "normal" | "high" | "urgent" | "critical"
  version?: number
}

export interface AuthenticatedInterface {
  readonly me: () => Effect.Effect<MeResponse, Error>
  readonly orgs: () => Effect.Effect<OrgsResponse, Error>
  readonly capabilities: () => Effect.Effect<CapabilitiesResponse, Error>
  readonly projects: () => Effect.Effect<ProjectsResponse, Error>
  readonly modules: (filter?: ModulesFilter) => Effect.Effect<ModulesResponse, Error>
  readonly tasks: (filter?: TasksFilter) => Effect.Effect<TasksResponse, Error>
  readonly events: (filter?: EventsFilter) => Effect.Effect<EventsResponse, Error>
  readonly createEvent: (input: CreateEventInput) => Effect.Effect<Event, Error>
  readonly updateTask: (taskId: string, input: UpdateTaskInput) => Effect.Effect<Task, Error>
}

export interface Interface {
  readonly health: () => Effect.Effect<HealthResponse, Error>
  readonly authenticated: <A, E, R>(
    use: (service: AuthenticatedInterface) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, Error | E, R>
  readonly me: () => Effect.Effect<MeResponse, Error>
  readonly orgs: () => Effect.Effect<OrgsResponse, Error>
  readonly capabilities: () => Effect.Effect<CapabilitiesResponse, Error>
  readonly projects: () => Effect.Effect<ProjectsResponse, Error>
  readonly modules: (filter?: ModulesFilter) => Effect.Effect<ModulesResponse, Error>
  readonly tasks: (filter?: TasksFilter) => Effect.Effect<TasksResponse, Error>
  readonly events: (filter?: EventsFilter) => Effect.Effect<EventsResponse, Error>
  readonly createEvent: (input: CreateEventInput) => Effect.Effect<Event, Error>
  readonly updateTask: (taskId: string, input: UpdateTaskInput) => Effect.Effect<Task, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MapClient") {}

export const use = serviceUse(Service)

const baseUrl = () => {
  const configured = getMarksAgentString("MAP_API_BASE_URL") ?? getMarksAgentString("MARKSCODE_MAP_API_URL") ?? process.env.MAP_API_BASE_URL ?? process.env.MARKSCODE_MAP_API_URL ?? defaultBaseUrl
  const parsed = URL.parse(configured)
  if (
    !parsed ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "map.marks.ia.br" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    return undefined
  parsed.pathname = "/api/map/v3"
  return parsed.toString().replace(/\/$/, "")
}

export const layer: Layer.Layer<Service, never, Account.Service | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const account = yield* Account.Service
    const http = yield* HttpClient.HttpClient

    const request = Effect.fnUntraced(function* <S extends Schema.Top>(input: {
      operation: string
      path: string
      schema: S
      lease?: Account.ActiveOrgLease
      query?: Readonly<Record<string, string | undefined>>
      method?: "GET" | "POST" | "PATCH"
      body?: unknown
    }) {
      const base = baseUrl()
      if (!base) return yield* new UnavailableError({ operation: input.operation, reason: "unsafe_base" })
      const endpoint = new URL(`${base}${input.path}`)
      Object.entries(input.query ?? {}).forEach(([key, value]) => {
        if (value !== undefined) endpoint.searchParams.set(key, value)
      })
      const base_request =
        input.method === "POST"
          ? HttpClientRequest.post(endpoint.toString())
          : input.method === "PATCH"
            ? HttpClientRequest.patch(endpoint.toString())
            : HttpClientRequest.get(endpoint.toString())
      const headed = base_request.pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.setHeaders({ "user-agent": userAgent }),
      )
      const initial =
        input.body === undefined
          ? headed
          : yield* HttpClientRequest.bodyJson(headed, input.body).pipe(
              Effect.mapError(() => new TransportError({ operation: input.operation })),
            )
      const execute = (request: HttpClientRequest.HttpClientRequest) =>
        http.execute(request).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
          Effect.mapError(() => new TransportError({ operation: input.operation })),
        )
      const decode = Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse) {
        if (response.status < 200 || response.status >= 300) {
          const parsed = yield* HttpClientResponse.schemaBodyJson(ErrorBody)(response).pipe(Effect.option)
          const detail = Option.isSome(parsed) ? safeDetail(parsed.value.message) : undefined
          const code = Option.isSome(parsed) ? parsed.value.error : undefined
          if (input.lease && (response.status === 401 || response.status === 403)) {
            return yield* new UnauthorizedError({ operation: input.operation, status: response.status, code, detail })
          }
          return yield* new ResponseError({ operation: input.operation, status: response.status, code, detail })
        }
        return yield* HttpClientResponse.schemaBodyJson(input.schema)(response).pipe(
          Effect.mapError(() => new DecodeError({ operation: input.operation })),
        )
      })
      const attempt = Effect.gen(function* () {
        if (!input.lease) return yield* decode(yield* execute(initial))
        const valid = yield* account
          .validateActiveOrgLease(input.lease)
          .pipe(Effect.mapError(() => new TransportError({ operation: input.operation })))
        if (!valid) return yield* new UnavailableError({ operation: input.operation, reason: "org_changed" })
        const response = yield* execute(
          initial.pipe(
            HttpClientRequest.bearerToken(input.lease.accessToken),
            HttpClientRequest.setHeaders({ "x-org-id": input.lease.active.org.id }),
          ),
        )
        const confirmed = yield* account
          .validateActiveOrgLease(input.lease)
          .pipe(Effect.mapError(() => new TransportError({ operation: input.operation })))
        if (!confirmed) return yield* new UnavailableError({ operation: input.operation, reason: "org_changed" })
        return yield* decode(response)
      })
      return yield* attempt.pipe(
        Effect.retry({
          while: (error) =>
            error._tag === "MapTransportError" ||
            (error._tag === "MapResponseError" &&
              (error.status === 408 || error.status === 429 || error.status >= 500)),
          times: 2,
          schedule: Schedule.exponential(200).pipe(Schedule.jittered),
        }),
      )
    })

    const authenticated = Effect.fn("MapClient.authenticated")(function* <A, E, R>(
      use: (service: AuthenticatedInterface) => Effect.Effect<A, E, R>,
    ) {
      const lease = yield* account
        .acquireActiveOrgLease()
        .pipe(Effect.mapError(() => new TransportError({ operation: "authenticated" })))
      if (Option.isNone(lease)) {
        const logged = yield* account
          .active()
          .pipe(Effect.mapError(() => new TransportError({ operation: "authenticated" })))
        const token = Option.isSome(logged)
          ? yield* account
              .token(logged.value.id)
              .pipe(Effect.mapError(() => new TransportError({ operation: "authenticated" })))
          : Option.none<Account.AccessToken>()
        return yield* new UnavailableError({
          operation: "authenticated",
          reason: Option.isNone(logged) ? "not_logged" : Option.isNone(token) ? "no_token" : "no_org",
        })
      }
      return yield* use({
        me: () => request({ operation: "me", path: "/me", schema: MeResponse, lease: lease.value }),
        orgs: () => request({ operation: "orgs", path: "/orgs", schema: OrgsResponse, lease: lease.value }),
        capabilities: () =>
          request({
            operation: "capabilities",
            path: "/capabilities",
            schema: CapabilitiesResponse,
            lease: lease.value,
          }),
        projects: () =>
          request({ operation: "projects", path: "/projects", schema: ProjectsResponse, lease: lease.value }),
        modules: (filter) =>
          request({
            operation: "modules",
            path: "/modules",
            schema: ModulesResponse,
            lease: lease.value,
            query: filter,
          }),
        tasks: (filter) =>
          request({ operation: "tasks", path: "/tasks", schema: TasksResponse, lease: lease.value, query: filter }),
        events: (filter) =>
          request({ operation: "events", path: "/events", schema: EventsResponse, lease: lease.value, query: filter }),
        createEvent: (payload) =>
          request({
            operation: "createEvent",
            path: "/events",
            method: "POST",
            body: payload,
            schema: Event,
            lease: lease.value,
          }),
        updateTask: (taskId, patch) =>
          request({
            operation: "updateTask",
            path: `/tasks/${encodeURIComponent(taskId)}`,
            method: "PATCH",
            body: patch,
            schema: Task,
            lease: lease.value,
          }),
      })
    })
    const service: Interface = {
      health: () => request({ operation: "health", path: "/health", schema: HealthResponse }),
      authenticated,
      me: () => authenticated((scope) => scope.me()),
      orgs: () => authenticated((scope) => scope.orgs()),
      capabilities: () => authenticated((scope) => scope.capabilities()),
      projects: () => authenticated((scope) => scope.projects()),
      modules: (filter) => authenticated((scope) => scope.modules(filter)),
      tasks: (filter) => authenticated((scope) => scope.tasks(filter)),
      events: (filter) => authenticated((scope) => scope.events(filter)),
      createEvent: (input) => authenticated((scope) => scope.createEvent(input)),
      updateTask: (taskId, input) => authenticated((scope) => scope.updateTask(taskId, input)),
    }
    return Service.of(service)
  }),
)

export * as MapClient from "./client"
