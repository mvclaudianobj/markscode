import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"
import { UpdateManager } from "@/update/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "cli-upgrade" })

export async function upgrade() {
  const config = await Config.global()
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => undefined)

  if (!latest) {
    log.debug("no latest version found")
    return
  }

  if (Installation.VERSION === latest) {
    log.debug("already on latest version")
    return
  }

  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) {
    log.debug("autoupdate disabled")
    return
  }

  if (config.autoupdate === "notify") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    log.info("update available (notify mode)", { current: Installation.VERSION, latest })
    return
  }

  if (method === "unknown") {
    log.warn("unknown installation method, skipping update")
    return
  }

  log.info("starting update", { current: Installation.VERSION, target: latest, method })

  const result = await UpdateManager.checkAndUpdate()

  if (result.updated) {
    log.info("update successful", { version: result.version })
    await Bus.publish(Installation.Event.Updated, { version: result.version! })
  } else if (result.rolledBack) {
    log.warn("update failed and rolled back", { error: result.error })
  } else if (result.error) {
    log.error("update failed", { error: result.error })
  }
}

export async function rollback(): Promise<{
  success: boolean
  backupPath?: string
  error?: string
}> {
  return await UpdateManager.rollbackToLatestBackup()
}
