import path from "path"
import { $ } from "bun"
import * as Log from "@opencode-ai/core/util/log"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Global } from "@opencode-ai/core/global"

export namespace Backup {
  const log = Log.create({ service: "update-backup" })

  const BACKUP_DIR = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".markscode/backups")
  const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".config"), "markscode")

  async function createBackupDir(): Promise<string> {
    const version = InstallationVersion ?? "local"
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    const backupPath = path.join(BACKUP_DIR, `v${version}-${timestamp}`)
    
    await $`mkdir -p ${backupPath}`.nothrow()
    await $`mkdir -p ${BACKUP_DIR}`.nothrow()
    
    return backupPath
  }

  async function backupBinary(backupPath: string): Promise<void> {
    const binaryPath = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".markscode/bin/markscode")
    
    if (await $`test -f ${binaryPath}`.quiet().nothrow()) {
      await $`cp ${binaryPath} ${backupPath}/markscode.backup`.nothrow()
      log.info("backup", { file: "markscode binary", backup: backupPath })
    }
  }

  async function backupConfig(backupPath: string): Promise<void> {
    const configFiles = [
      path.join(CONFIG_DIR, "markscode.json"),
      path.join(CONFIG_DIR, "markscode.jsonc"),
      path.join(CONFIG_DIR, "config.json"),
    ]

    for (const file of configFiles) {
      if (await $`test -f ${file}`.quiet().nothrow()) {
        const base = path.basename(file)
        await $`cp ${file} ${path.join(backupPath, base + ".backup")}`.quiet().nothrow()
        log.info("backup", { file: file, backup: backupPath })
      }
    }
  }

  async function backupDatabase(backupPath: string): Promise<void> {
    const dbPath = path.join(Global.Path.data, "markscode.db")
    
    if (await $`test -f ${dbPath}`.quiet().nothrow()) {
      await $`cp ${dbPath} ${backupPath}/markscode.db.backup`.nothrow()
      log.info("backup", { file: "database", backup: backupPath })
    }
  }

  export async function createBackup(): Promise<string> {
    log.info("starting backup before update")
    
    const backupPath = await createBackupDir()
    
    await Promise.all([
      backupBinary(backupPath),
      backupConfig(backupPath),
      backupDatabase(backupPath),
    ])

    log.info("backup completed", { backupPath })
    return backupPath
  }

  export async function restoreBackup(backupPath: string): Promise<void> {
    log.info("restoring from backup", { backupPath })
    
    const restorePaths: Record<string, string> = {
      "markscode.backup": path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".markscode/bin/markscode"),
      "markscode.json.backup": path.join(CONFIG_DIR, "markscode.json"),
      "markscode.jsonc.backup": path.join(CONFIG_DIR, "markscode.jsonc"),
      "config.json.backup": path.join(CONFIG_DIR, "config.json"),
      "markscode.db.backup": path.join(Global.Path.data, "markscode.db"),
    }

    for (const [backupFile, restorePath] of Object.entries(restorePaths)) {
      const backupFilepath = path.join(backupPath, backupFile)
      
      if (await $`test -f ${backupFilepath}`.quiet().nothrow()) {
        await $`mkdir -p ${path.dirname(restorePath)}`.nothrow()
        await $`cp ${backupFilepath} ${restorePath}`.quiet().nothrow()
        log.info("restored", { file: backupFile, to: restorePath })
      }
    }

    log.info("restore completed")
  }

  export async function listBackups(): Promise<string[]> {
    const testResult = await $`test -d ${BACKUP_DIR}`.quiet().nothrow()
    if (testResult.exitCode !== 0) {
      return []
    }
    
    const result = await $`ls -la ${BACKUP_DIR}`.nothrow()
    const lines = result.stdout.toString().split("\n").filter(line => line.startsWith("d"))
    const items = lines.map(line => line.trim().split(/\s+/).pop()).filter((x): x is string => Boolean(x))
    return items
  }

  export async function cleanupOldBackups(): Promise<void> {
    const backups = await listBackups()
    
    if (backups.length <= 1) return

    const sortedBackups = backups.sort().reverse()
    const oldBackups = sortedBackups.slice(1) // Keep only the most recent

    for (const backup of oldBackups) {
      const backupPath = path.join(BACKUP_DIR, backup)
      await $`rm -rf ${backupPath}`.nothrow()
      log.info("removed old backup", { backupPath })
    }
  }
}
