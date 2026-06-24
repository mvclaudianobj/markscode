import { eq } from "drizzle-orm"

import { Database } from "@/storage/db"
import { RemoteSSHProfileTable } from "./profile.sql"
import { ensureMasterKeyPair, setupKeyForHost, encryptCredential } from "./pki"

export type RemoteSSHProfileRow = typeof RemoteSSHProfileTable.$inferSelect
export type RemoteSSHProfileInput = Omit<RemoteSSHProfileRow, "time_created" | "time_updated">
export type RemoteProfileProtocol = "ssh" | "winrm" | "whm" | "custom"

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

export function listRemoteProfilesByProtocol(protocol: RemoteProfileProtocol) {
  return Database.use((db) =>
    db.select().from(RemoteSSHProfileTable).where(eq(RemoteSSHProfileTable.protocol, protocol)).all(),
  )
}

export function createProfileWithMasterKey(profile: Omit<RemoteSSHProfileInput, "pki_enabled" | "master_key_ref"> & { deployKey?: boolean }) {
  const keys = ensureMasterKeyPair()
  const now = Date.now()

  const enhanced: RemoteSSHProfileInput = {
    ...profile,
    pki_enabled: 1,
    master_key_ref: "marks-key-mestra",
    identity_file: profile.identity_file || keys.privateKeyPath,
    key_name: profile.key_name || "marks-key-mestra",
  }

  Database.use((db) =>
    db
      .insert(RemoteSSHProfileTable)
      .values({ ...enhanced, time_created: now, time_updated: now })
      .onConflictDoUpdate({
        target: RemoteSSHProfileTable.id,
        set: { ...enhanced, time_updated: now },
      })
      .run(),
  )

  if (profile.deployKey && profile.host && profile.user) {
    setupKeyForHost(profile.host, profile.user, profile.port || 22)
  }

  return enhanced
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
