import { existsSync, readFileSync, writeFileSync } from "fs"
import { execSync } from "child_process"
import { homedir } from "os"
import { join } from "path"

const MASTER_KEY_NAME = "marks-key-mestra"
const MASTER_KEY_PATH = join(homedir(), ".ssh", MASTER_KEY_NAME)
const MASTER_PUB_PATH = `${MASTER_KEY_PATH}.pub`

export function ensureMasterKeyPair(): { privateKeyPath: string; publicKeyPath: string } {
  if (existsSync(MASTER_KEY_PATH) && existsSync(MASTER_PUB_PATH)) {
    return { privateKeyPath: MASTER_KEY_PATH, publicKeyPath: MASTER_PUB_PATH }
  }

  execSync(`ssh-keygen -t ed25519 -f "${MASTER_KEY_PATH}" -N "" -C "${MASTER_KEY_NAME}"`, { stdio: "inherit" })
  execSync(`chmod 600 "${MASTER_KEY_PATH}"`, { stdio: "inherit" })
  execSync(`chmod 644 "${MASTER_PUB_PATH}"`, { stdio: "inherit" })

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

  try {
    execSync(`ssh-copy-id -i "${keys.publicKeyPath}" -p ${port} "${user}@${host}"`, { stdio: "inherit" })
  } catch (err) {
    const fallback = `ssh "${user}@${host}" -p ${port} "mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${pubKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"`
    execSync(fallback, { stdio: "inherit" })
  }
}

export * as RemotePKI from "./pki"
