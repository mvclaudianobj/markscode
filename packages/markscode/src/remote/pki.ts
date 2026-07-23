import { existsSync, readFileSync, writeFileSync } from "fs"
import { execFileSync, spawnSync } from "child_process"
import { homedir } from "os"
import { join } from "path"

const MASTER_KEY_NAME = "marks-key-mestra"
const MASTER_KEY_PATH = join(homedir(), ".ssh", MASTER_KEY_NAME)
const MASTER_PUB_PATH = `${MASTER_KEY_PATH}.pub`

export function ensureMasterKeyPair(): { privateKeyPath: string; publicKeyPath: string } {
  if (existsSync(MASTER_KEY_PATH) && existsSync(MASTER_PUB_PATH)) {
    return { privateKeyPath: MASTER_KEY_PATH, publicKeyPath: MASTER_PUB_PATH }
  }

  execFileSync("ssh-keygen", ["-t", "ed25519", "-f", MASTER_KEY_PATH, "-N", "", "-C", MASTER_KEY_NAME], { stdio: "inherit" })
  execFileSync("chmod", ["600", MASTER_KEY_PATH], { stdio: "inherit" })
  execFileSync("chmod", ["644", MASTER_PUB_PATH], { stdio: "inherit" })

  return { privateKeyPath: MASTER_KEY_PATH, publicKeyPath: MASTER_PUB_PATH }
}

export function getMasterPublicKey(): string {
  if (!existsSync(MASTER_PUB_PATH)) {
    ensureMasterKeyPair()
  }
  return readFileSync(MASTER_PUB_PATH, "utf-8").trim()
}

export function encryptCredential(plaintext: string, keyPath?: string): string {
  const key = keyPath || MASTER_KEY_PATH
  if (!existsSync(key)) {
    throw new Error(`Master key not found: ${key}`)
  }
  const b64 = Buffer.from(plaintext, "utf-8").toString("base64")
  return `encrypted:${b64}`
}

export function decryptCredential(ciphertext: string, keyPath?: string): string {
  if (!ciphertext.startsWith("encrypted:")) {
    return ciphertext
  }
  const b64 = ciphertext.slice("encrypted:".length)
  return Buffer.from(b64, "base64").toString("utf-8")
}

export function setupKeyForHost(host: string, user: string, port = 22): void {
  const keys = ensureMasterKeyPair()
  const pubKey = getMasterPublicKey()
  const safePort = Number.isInteger(port) && port > 0 && port <= 65535 ? String(port) : undefined

  if (!safePort) throw new Error("Invalid SSH port")
  if (!/^[A-Za-z0-9._:-]+$/.test(host)) throw new Error("Invalid SSH host")
  if (!/^[A-Za-z0-9._-]+$/.test(user)) throw new Error("Invalid SSH user")

  try {
    execFileSync("ssh-copy-id", ["-i", keys.publicKeyPath, "-p", safePort, `${user}@${host}`], { stdio: "inherit" })
  } catch (err) {
    const proc = spawnSync("ssh", ["-p", safePort, `${user}@${host}`, "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"], { input: pubKey + "\n", stdio: ["pipe", "inherit", "inherit"] })
    if (proc.status !== 0) throw err
  }
}

export * as RemotePKI from "./pki"
