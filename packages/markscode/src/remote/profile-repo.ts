import { eq } from "drizzle-orm"

import { Database } from "@/storage/db"
import { RemoteSSHProfileTable } from "./profile.sql"

export type RemoteSSHProfileRow = typeof RemoteSSHProfileTable.$inferSelect
export type RemoteSSHProfileInput = Omit<RemoteSSHProfileRow, "time_created" | "time_updated">

const now = () => Date.now()

const safeProfile = (profile: RemoteSSHProfileInput): RemoteSSHProfileInput => ({
  ...profile,
  type: profile.type || "ssh",
  port: profile.port || 22,
  auth_method: profile.auth_method || (profile.credential_ref ? "password_ref" : profile.identity_file || profile.key_name ? "key" : null),
})

export function listRemoteSSHProfiles() {
  return Database.use((db) =>
    db.select().from(RemoteSSHProfileTable).all().toSorted((a, b) => a.name.localeCompare(b.name)),
  )
}

export function upsertRemoteSSHProfile(profile: RemoteSSHProfileInput) {
  const safe = safeProfile(profile)
  return Database.use((db) =>
    db
      .insert(RemoteSSHProfileTable)
      .values({ ...safe, time_created: now(), time_updated: now() })
      .onConflictDoUpdate({
        target: RemoteSSHProfileTable.id,
        set: { ...safe, time_updated: now() },
      })
      .run(),
  )
}

export function replaceRemoteSSHProfiles(profiles: RemoteSSHProfileInput[]) {
  return Database.transaction((db) => {
    db.delete(RemoteSSHProfileTable).run()
    profiles.map((profile) => {
      const safe = safeProfile(profile)
      return db.insert(RemoteSSHProfileTable).values({ ...safe, time_created: now(), time_updated: now() }).run()
    })
  })
}

export function deleteRemoteSSHProfile(id: string) {
  return Database.use((db) => db.delete(RemoteSSHProfileTable).where(eq(RemoteSSHProfileTable.id, id)).run())
}

export * as RemoteSSHProfileRepo from "./profile-repo"
