import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { UpdateManager } from "@/update/manager"
import * as Log from "@opencode-ai/core/util/log"
import { AppRuntime } from "@/effect/app-runtime"

const log = Log.create({ service: "cli-upgrade" })

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((service) => service.getGlobal())).catch(() => ({ autoupdate: true }))
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => undefined)

  if (!latest) {
    log.debug("no latest version found")
    return
  }

  if (InstallationVersion === latest) {
    log.debug("already on latest version")
    return
  }

  if (config.autoupdate === false || Flag.OPENCODE_DISABLE_AUTOUPDATE) {
    log.debug("autoupdate disabled")
    return
  }

  if (config.autoupdate === "notify") {
    await Bus.publish(Installation.Event.UpdateAvailable, { version: latest })
    log.info("update available (notify mode)", { current: InstallationVersion, latest })
    return
  }

  if (method === "unknown") {
    log.warn("unknown installation method, skipping update")
    return
  }

  log.info("starting update", { current: InstallationVersion, target: latest, method })

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
