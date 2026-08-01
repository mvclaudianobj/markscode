import { and, eq, isNull, sql } from "drizzle-orm"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { Effect, Layer, Option, Schema, Context } from "effect"

import { Database } from "@/storage/db"
import { AccountStateTable, AccountTable } from "./account.sql"
import { AccessToken, AccountID, AccountRepoError, Info, OrgID, RefreshToken, AccountUnauthorizedError } from "./schema"
import { normalizeServerUrl } from "./url"

export type AccountRow = (typeof AccountTable)["$inferSelect"]
export type AccountStateRow = (typeof AccountStateTable)["$inferSelect"]
export type ActiveSnapshot = {
  account: Info
  revision: number
}

type DbClient = Parameters<typeof Database.use>[0] extends (db: infer T) => unknown ? T : never
type DbTransactionCallback<A> = Parameters<typeof Database.transaction<A>>[0]

const ACCOUNT_STATE_ID = 1

export interface Interface {
  readonly active: () => Effect.Effect<Option.Option<Info>, AccountRepoError>
  readonly activeSnapshot: () => Effect.Effect<Option.Option<ActiveSnapshot>, AccountRepoError>
  readonly state: () => Effect.Effect<AccountStateRow, AccountRepoError>
  readonly list: () => Effect.Effect<Info[], AccountRepoError>
  readonly remove: (accountID: AccountID) => Effect.Effect<void, AccountRepoError>
  readonly use: (accountID: AccountID, orgID: Option.Option<OrgID>) => Effect.Effect<void, AccountRepoError>
  readonly compareAndUse: (input: {
    accountID: AccountID
    expectedOrgID: Option.Option<OrgID>
    expectedRevision: number
    orgID: Option.Option<OrgID>
  }) => Effect.Effect<boolean, AccountRepoError>
  readonly getRow: (accountID: AccountID) => Effect.Effect<Option.Option<AccountRow>, AccountRepoError>
  readonly persistToken: (input: {
    accountID: AccountID
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry: Option.Option<number>
  }) => Effect.Effect<void, AccountRepoError>
  readonly persistAccount: (input: {
    id: AccountID
    email: string
    url: string
    accessToken: AccessToken
    refreshToken: RefreshToken
    expiry: number
    orgID: Option.Option<OrgID>
  }) => Effect.Effect<void, AccountRepoError>
  readonly invalidateToken: (accountID: AccountID) => Effect.Effect<void, AccountRepoError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AccountRepo") {}

export const use = serviceUse(Service)

export const layer: Layer.Layer<Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const decode = Schema.decodeUnknownSync(Info)

    const query = <A>(f: DbTransactionCallback<A>) =>
      Effect.try({
        try: () => Database.use(f),
        catch: (cause) => new AccountRepoError({ message: "Database operation failed", cause }),
      })

    const tx = <A>(f: DbTransactionCallback<A>) =>
      Effect.try({
        try: () => Database.transaction(f),
        catch: (cause) => new AccountRepoError({ message: "Database operation failed", cause }),
      })

    const current = (db: DbClient) => {
      const state = db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()
      if (!state?.active_account_id) return
      const account = db.select().from(AccountTable).where(eq(AccountTable.id, state.active_account_id)).get()
      if (!account) return
      return { account: { ...account, active_org_id: state.active_org_id ?? null }, revision: state.revision }
    }

    const setState = (db: DbClient, accountID: AccountID | null, orgID: Option.Option<OrgID>) => {
      const id = Option.getOrNull(orgID)
      return db
        .insert(AccountStateTable)
        .values({ id: ACCOUNT_STATE_ID, active_account_id: accountID, active_org_id: id })
        .onConflictDoUpdate({
          target: AccountStateTable.id,
          set: { active_account_id: accountID, active_org_id: id, revision: sql`${AccountStateTable.revision} + 1` },
        })
        .run()
    }

    const state = Effect.fn("AccountRepo.state")(() =>
      query((db) => {
        const row = db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()
        if (row) return row
        db.insert(AccountStateTable).values({ id: ACCOUNT_STATE_ID }).run()
        return db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()!
      }),
    )

    const active = Effect.fn("AccountRepo.active")(() =>
      query((db) => current(db)).pipe(Effect.map((row) => (row ? Option.some(decode(row.account)) : Option.none()))),
    )

    const activeSnapshot = Effect.fn("AccountRepo.activeSnapshot")(() =>
      query((db) => current(db)).pipe(
        Effect.map((row) => row ? Option.some({ account: decode(row.account), revision: row.revision }) : Option.none()),
      ),
    )

    const list = Effect.fn("AccountRepo.list")(() =>
      query((db) =>
        db
          .select()
          .from(AccountTable)
          .all()
          .map((row: AccountRow) => decode({ ...row, active_org_id: null })),
      ),
    )

    const remove = Effect.fn("AccountRepo.remove")((accountID: AccountID) =>
      tx((db) => {
        const selected = db.select().from(AccountStateTable).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).get()
        if (selected?.active_account_id === accountID) setState(db, null, Option.none())
        else if (selected) db.update(AccountStateTable).set({ revision: sql`${AccountStateTable.revision} + 1` }).where(eq(AccountStateTable.id, ACCOUNT_STATE_ID)).run()
        else db.insert(AccountStateTable).values({ id: ACCOUNT_STATE_ID }).run()
        db.delete(AccountTable).where(eq(AccountTable.id, accountID)).run()
      }).pipe(Effect.asVoid),
    )

    const use = Effect.fn("AccountRepo.use")((accountID: AccountID, orgID: Option.Option<OrgID>) =>
      query((db) => setState(db, accountID, orgID)).pipe(Effect.asVoid),
    )

    const compareAndUse = Effect.fn("AccountRepo.compareAndUse")((input) =>
      tx((db) => {
        const expectedOrgID = Option.getOrNull(input.expectedOrgID)
        const where = and(
          eq(AccountStateTable.id, ACCOUNT_STATE_ID),
          eq(AccountStateTable.active_account_id, input.accountID),
          expectedOrgID === null ? isNull(AccountStateTable.active_org_id) : sql`${AccountStateTable.active_org_id} = ${expectedOrgID}`,
          eq(AccountStateTable.revision, input.expectedRevision),
        )
        return db.update(AccountStateTable).set({
          active_account_id: input.accountID,
          active_org_id: Option.getOrNull(input.orgID),
          revision: sql`${AccountStateTable.revision} + 1`,
        }).where(where).returning({ revision: AccountStateTable.revision }).get() !== undefined
      }),
    )

    const getRow = Effect.fn("AccountRepo.getRow")((accountID: AccountID) =>
      query((db) => db.select().from(AccountTable).where(eq(AccountTable.id, accountID)).get()).pipe(
        Effect.map(Option.fromNullishOr),
      ),
    )

    const persistToken = Effect.fn("AccountRepo.persistToken")((input) =>
      query((db) =>
        db
          .update(AccountTable)
          .set({
            access_token: input.accessToken,
            refresh_token: input.refreshToken,
            token_expiry: Option.getOrNull(input.expiry),
          })
          .where(eq(AccountTable.id, input.accountID))
          .run(),
      ).pipe(Effect.asVoid),
    )

    const persistAccount = Effect.fn("AccountRepo.persistAccount")((input) =>
      tx((db) => {
        const url = normalizeServerUrl(input.url)

        db.insert(AccountTable)
          .values({
            id: input.id,
            email: input.email,
            url,
            access_token: input.accessToken,
            refresh_token: input.refreshToken,
            token_expiry: input.expiry,
          })
          .onConflictDoUpdate({
            target: AccountTable.id,
            set: {
              email: input.email,
              url,
              access_token: input.accessToken,
              refresh_token: input.refreshToken,
              token_expiry: input.expiry,
            },
          })
          .run()
        void setState(db, input.id, input.orgID)
      }).pipe(Effect.asVoid),
    )

    const invalidateToken = Effect.fn("AccountRepo.invalidateToken")((accountID: AccountID) =>
      query((db) =>
        db
          .update(AccountTable)
          .set({ token_expiry: null })
          .where(eq(AccountTable.id, accountID))
          .run(),
      ).pipe(Effect.asVoid),
    )

    return Service.of({
      active,
      activeSnapshot,
      state,
      list,
      remove,
      use,
      compareAndUse,
      getRow,
      persistToken,
      persistAccount,
      invalidateToken,
    })
  }),
)

export * as AccountRepo from "./repo"
