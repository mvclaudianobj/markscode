import { Context, Effect, Layer, Option, Schema } from "effect"
import stripAnsi from "strip-ansi"
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http"

import { Account } from "@/account/account"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { RagConfig } from "./rag-config"

const PositiveID = Schema.Int.check(Schema.isGreaterThan(0))
type JsonValue = Schema.Schema.Type<typeof Schema.Json>
const ErrorDetail = Schema.Struct({ detail: Schema.optional(Schema.String) })
const safeDetail = (value: string) => stripAnsi(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 512)

export function endpointUrl(baseUrl: string, path: string, origin: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("?") || path.includes("#")) return
  const decoded = Option.liftThrowable(() => Array.from({ length: 8 }).reduce<string>((value) => decodeURIComponent(value), path))()
  if (Option.isNone(decoded)) return
  const stable = Option.liftThrowable(() => decodeURIComponent(decoded.value))()
  if (
    Option.isNone(stable) ||
    stable.value !== decoded.value ||
    decoded.value.startsWith("//") ||
    decoded.value.includes("\\") ||
    decoded.value.split("/").some((segment) => segment === "..")
  ) return
  const base = URL.parse(baseUrl)
  if (!base || base.origin !== origin || base.username || base.password || base.search || base.hash) return
  const directory = new URL(base)
  directory.pathname = `${directory.pathname.replace(/\/+$/, "")}/`
  const endpoint = URL.parse(path.slice(1), directory)
  if (!endpoint || endpoint.origin !== origin || !endpoint.pathname.startsWith(directory.pathname)) return
  return endpoint
}

export class Collection extends Schema.Class<Collection>("RagCollection")({
  id: PositiveID,
  org_id: PositiveID,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.String),
  created_at: Schema.optional(Schema.String),
  updated_at: Schema.optional(Schema.String),
}) {}

export class Source extends Schema.Class<Source>("RagSource")({
  id: PositiveID,
  org_id: PositiveID,
  collection_id: PositiveID,
  source_type: Schema.String,
  source_key: Schema.String,
  external_key: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.String,
  status: Schema.optional(Schema.String),
  metadata_json: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.optional(Schema.String),
  updated_at: Schema.optional(Schema.String),
}) {}

export class Document extends Schema.Class<Document>("RagDocument")({
  id: PositiveID,
  org_id: PositiveID,
  collection_id: PositiveID,
  source_id: Schema.optional(Schema.NullOr(PositiveID)),
  title: Schema.String,
  content_hash: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  metadata_json: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.optional(Schema.String),
  updated_at: Schema.optional(Schema.String),
}) {}

export class QueryItem extends Schema.Class<QueryItem>("RagQueryItem")({
  id: PositiveID,
  org_id: PositiveID,
  collection_id: PositiveID,
  document_id: PositiveID,
  chunk_index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  content: Schema.String,
  score: Schema.Number,
}) {}

export class HealthResponse extends Schema.Class<HealthResponse>("RagHealthResponse")({
  ok: Schema.Boolean,
  org_id: PositiveID,
  search_mode: Schema.Literal("lexical"),
}) {}

export class CollectionsResponse extends Schema.Class<CollectionsResponse>("RagCollectionsResponse")({
  ok: Schema.Boolean,
  items: Schema.Array(Collection),
}) {}

export class CollectionResponse extends Schema.Class<CollectionResponse>("RagCollectionResponse")({
  ok: Schema.Boolean,
  item: Collection,
}) {}

export class SourceResponse extends Schema.Class<SourceResponse>("RagSourceResponse")({
  ok: Schema.Boolean,
  item: Source,
}) {}

export class DocumentResponse extends Schema.Class<DocumentResponse>("RagDocumentResponse")({
  ok: Schema.Boolean,
  item: Document,
}) {}

export class QueryResponse extends Schema.Class<QueryResponse>("RagQueryResponse")({
  ok: Schema.Boolean,
  search_mode: Schema.Literal("lexical"),
  items: Schema.Array(QueryItem),
}) {}

export class UnavailableError extends Schema.TaggedErrorClass<UnavailableError>()("RagUnavailableError", {
  reason: Schema.Literals(["disabled", "not_logged", "no_org", "version", "capability"]),
  operation: Schema.String,
}) {}

export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()("RagUnauthorizedError", {
  operation: Schema.String,
  status: Schema.Literals([401, 403]),
}) {}

export class ResponseError extends Schema.TaggedErrorClass<ResponseError>()("RagResponseError", {
  operation: Schema.String,
  status: Schema.Number,
  detail: Schema.optional(Schema.String),
}) {}

export class TransportError extends Schema.TaggedErrorClass<TransportError>()("RagTransportError", {
  operation: Schema.String,
}) {}

export class DecodeError extends Schema.TaggedErrorClass<DecodeError>()("RagDecodeError", {
  operation: Schema.String,
}) {}

export type Error = UnavailableError | UnauthorizedError | ResponseError | TransportError | DecodeError

export type CreateCollectionInput = { name: string; description?: string }
export type CreateSourceInput = {
  collection_id: number
  source_type: string
  source_key: string
  name: string
  external_key?: string
  metadata?: JsonValue
}
export type IngestDocumentInput = {
  collection_id: number
  source_id?: number
  title: string
  content: string
  metadata?: JsonValue
}
export type QueryInput = { query: string; collection_id?: number; limit?: number }

export interface Interface {
  readonly health: () => Effect.Effect<HealthResponse, Error>
  readonly listCollections: () => Effect.Effect<CollectionsResponse, Error>
  readonly createCollection: (input: CreateCollectionInput) => Effect.Effect<CollectionResponse, Error>
  readonly createSource: (input: CreateSourceInput) => Effect.Effect<SourceResponse, Error>
  readonly ingestDocument: (input: IngestDocumentInput) => Effect.Effect<DocumentResponse, Error>
  readonly query: (input: QueryInput) => Effect.Effect<QueryResponse, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RagClient") {}

type Capability = keyof RagConfig.Capabilities

export const layer: Layer.Layer<Service, never, Account.Service | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const account = yield* Account.Service
    const http = yield* HttpClient.HttpClient
    const read = withTransientReadRetry(http)
    const positive = (value: number | undefined) => value === undefined || Number.isInteger(value) && value > 0
    const valid = <A>(operation: string, input: A, predicate: (value: A) => boolean): Effect.Effect<A, DecodeError> => {
      if (predicate(input)) return Effect.succeed(input)
      return Effect.fail(new DecodeError({ operation }))
    }

    const request = Effect.fnUntraced(function* <S extends Schema.Top, I>(input: {
      operation: string
      capability: Capability
      method: "GET" | "POST"
      path: string
      body?: I
      schema: S
    }) {
      const active = yield* account.activeOrg().pipe(
        Effect.mapError(() => new TransportError({ operation: input.operation })),
      )
      if (Option.isNone(active)) {
        const logged = yield* account.active().pipe(Effect.mapError(() => new TransportError({ operation: input.operation })))
        return yield* new UnavailableError({
          operation: input.operation,
          reason: Option.isNone(logged) ? "not_logged" : "no_org",
        })
      }

      const config = RagConfig.getRagConfig(active.value.account.id, active.value.org.id)
      if (!config?.enabled) return yield* new UnavailableError({ operation: input.operation, reason: "disabled" })
      if (config.version !== 1) return yield* new UnavailableError({ operation: input.operation, reason: "version" })
      if (!config.capabilities[input.capability]) {
        return yield* new UnavailableError({ operation: input.operation, reason: "capability" })
      }
      if (config.account_id !== active.value.account.id || config.org_id !== active.value.org.id) {
        return yield* new UnavailableError({ operation: input.operation, reason: "disabled" })
      }

      const token = yield* account.token(active.value.account.id).pipe(
        Effect.mapError(() => new TransportError({ operation: input.operation })),
      )
      if (Option.isNone(token)) {
        return yield* new UnavailableError({ operation: input.operation, reason: "not_logged" })
      }

      const immediate = yield* account.activeOrg().pipe(
        Effect.mapError(() => new TransportError({ operation: input.operation })),
      )
      if (
        Option.isNone(immediate) ||
        immediate.value.account.id !== active.value.account.id ||
        immediate.value.org.id !== active.value.org.id
      ) return yield* new UnavailableError({ operation: input.operation, reason: "no_org" })

      const accountUrl = URL.parse(immediate.value.account.url)
      if (!accountUrl) return yield* new TransportError({ operation: input.operation })
      const base = URL.parse(config.base_url)
      if (!base) {
        RagConfig.clearRagConfig({ accountID: config.account_id, orgID: config.org_id, revision: config.revision })
        return yield* new UnavailableError({ operation: input.operation, reason: "disabled" })
      }
      const accountOrigin = accountUrl.origin
      if (base.origin !== accountOrigin || config.account_origin !== accountOrigin) {
        RagConfig.clearRagConfig({ accountID: config.account_id, orgID: config.org_id, revision: config.revision })
        return yield* new UnavailableError({ operation: input.operation, reason: "disabled" })
      }

      const body = input.operation === "query" && input.body && typeof input.body === "object"
        ? { ...input.body, limit: Math.min("limit" in input.body && typeof input.body.limit === "number" ? input.body.limit : config.limits.query_limit_max, config.limits.query_limit_max) }
        : input.body
      const endpoint = endpointUrl(config.base_url, input.path, accountOrigin)
      if (!endpoint) {
        RagConfig.clearRagConfig({ accountID: config.account_id, orgID: config.org_id, revision: config.revision })
        return yield* new UnavailableError({ operation: input.operation, reason: "disabled" })
      }
      const initial = input.method === "GET"
        ? HttpClientRequest.get(endpoint.toString())
        : HttpClientRequest.post(endpoint.toString())
      const authorized = initial.pipe(
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(token.value),
        HttpClientRequest.setHeaders({ "x-org-id": immediate.value.org.id }),
      )
      const req = body === undefined ? authorized : yield* HttpClientRequest.bodyJson(authorized, body).pipe(
        Effect.mapError(() => new TransportError({ operation: input.operation })),
      )
      const confirmed = yield* account.activeOrg().pipe(
        Effect.mapError(() => new TransportError({ operation: input.operation })),
      )
      if (
        Option.isNone(confirmed) ||
        confirmed.value.account.id !== config.account_id ||
        confirmed.value.org.id !== config.org_id ||
        !RagConfig.isCurrent(config)
      ) return yield* new UnavailableError({ operation: input.operation, reason: "disabled" })
      const response = yield* (input.method === "GET" ? read : http).execute(req).pipe(
        Effect.mapError((cause) => {
          if (HttpClientError.isHttpClientError(cause)) return new TransportError({ operation: input.operation })
          return new TransportError({ operation: input.operation })
        }),
      )
      if (response.status === 401 || response.status === 403) {
        return yield* new UnauthorizedError({ operation: input.operation, status: response.status })
      }
      if (response.status < 200 || response.status >= 300) {
        const parsed = yield* HttpClientResponse.schemaBodyJson(ErrorDetail)(response).pipe(Effect.option)
        return yield* new ResponseError({
          operation: input.operation,
          status: response.status,
          detail: Option.isSome(parsed) && parsed.value.detail ? safeDetail(parsed.value.detail) : undefined,
        })
      }
      return yield* HttpClientResponse.schemaBodyJson(input.schema)(response).pipe(
        Effect.mapError(() => new DecodeError({ operation: input.operation })),
      )
    })

    return Service.of({
      health: () => request({ operation: "health", capability: "health", method: "GET", path: "/health", schema: HealthResponse }),
      listCollections: () => request({ operation: "list_collections", capability: "list_collections", method: "GET", path: "/collections", schema: CollectionsResponse }),
      createCollection: (body) => valid("create_collection", body, (value) => value.name.trim().length > 0).pipe(
        Effect.flatMap((value) => request({ operation: "create_collection", capability: "create_collection", method: "POST", path: "/collections", body: value, schema: CollectionResponse })),
      ),
      createSource: (body) => valid("create_source", body, (value) =>
        positive(value.collection_id) && /^[a-f0-9]{64}$/i.test(value.source_key) && value.source_type.trim().length > 0 && value.name.trim().length > 0,
      ).pipe(Effect.flatMap((value) => request({ operation: "create_source", capability: "create_source", method: "POST", path: "/sources", body: value, schema: SourceResponse }))),
      ingestDocument: (body) => valid("ingest_document", body, (value) =>
        positive(value.collection_id) && positive(value.source_id) && value.title.trim().length > 0 && value.content.trim().length > 0,
      ).pipe(Effect.flatMap((value) => request({ operation: "ingest_document", capability: "ingest_document", method: "POST", path: "/documents", body: value, schema: DocumentResponse }))),
      query: (body) => valid("query", body, (value) =>
        value.query.trim().length > 0 && positive(value.collection_id) && positive(value.limit),
      ).pipe(Effect.flatMap((value) => request({ operation: "query", capability: "query", method: "POST", path: "/query", body: value, schema: QueryResponse }))),
    })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(Account.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
)

export * as RagClient from "./rag-client"
