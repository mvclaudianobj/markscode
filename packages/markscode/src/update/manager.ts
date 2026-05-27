import { $ } from "bun"
import { AppRuntime } from "@/effect/app-runtime"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Backup } from "./backup"
import { Validate } from "./validate"
import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import path from "path"

export namespace UpdateManager {
  const log = Log.create({ service: "update-manager" })

  export async function checkAndUpdate(): Promise<{
    updated: boolean
    version?: string
    error?: string
    rolledBack?: boolean
  }> {
    try {
      const method = await AppRuntime.runPromise(Installation.Service.use((service) => service.method()))
      const latest = await AppRuntime.runPromise(Installation.Service.use((service) => service.latest(method))).catch(
        () => undefined,
      )
      const current = InstallationVersion

      log.info("update check", { current, latest })

      if (!latest || current === latest) {
        return { updated: false }
      }

      log.info("update available", { current, latest })

      const config = await AppRuntime.runPromise(Config.Service.use((service) => service.getGlobal())).catch(() => ({
        autoupdate: true,
      }))
      if (config.autoupdate === false) {
        return { updated: false }
      }

      return await performUpdate(current, latest, method)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("update check failed", { error: message })
      return { updated: false, error: message }
    }
  }

  async function performUpdate(current: string, target: string, method: string): Promise<{
    updated: boolean
    version?: string
    error?: string
    rolledBack?: boolean
  }> {
    let backupPath: string | undefined
    let updateSucceeded = false

    try {
      backupPath = await Backup.createBackup()
      log.info("backup created", { backupPath })

      await performDownloadAndInstall(method, target)

      const installDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".markscode/bin")
      const binaryPath = path.join(installDir, "markscode")

      const validation = await Validate.validateBinary(binaryPath)
      if (!validation.valid) {
        throw new Error(`Binary validation failed: ${validation.errors.join(", ")}`)
      }

      updateSucceeded = true
      await Backup.cleanupOldBackups()

      log.info("update completed successfully", { version: target })
      return { updated: true, version: target }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("update failed", { error: message })

      if (backupPath) {
        try {
          await Backup.restoreBackup(backupPath)
          log.info("rollback completed", { from: backupPath })
          return { updated: false, error: message, rolledBack: true }
        } catch (rollbackError) {
          const rollbackMsg = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          log.error("rollback failed", { error: rollbackMsg })
          return { updated: false, error: `${message}; rollback failed: ${rollbackMsg}` }
        }
      }

      return { updated: false, error: message }
    }
  }

  async function performDownloadAndInstall(method: string, target: string): Promise<void> {
    if (method === "curl") {
      await runCurlUpdate(target)
    } else if (method === "npm" || method === "bun" || method === "pnpm") {
      await runPackageUpdate(method as "npm" | "bun" | "pnpm", target)
    } else if (method === "brew") {
      await runBrewUpdate(target)
    } else if (method === "choco") {
      await runChocoUpdate(target)
    } else if (method === "scoop") {
      await runScoopUpdate(target)
    } else {
      throw new Error(`Unsupported update method: ${method}`)
    }
  }

  async function runCurlUpdate(target: string): Promise<void> {
    const installDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".markscode/bin")
    const binBaseUrl = process.env.MARKSCODE_BIN_BASE_URL ?? "https://marks.fenixsol.com.br/bin"
    
    const script = buildUpdateScript(installDir, binBaseUrl, target)
    
    const result = await $`bash -c ${JSON.stringify(script)}`.nothrow()
    if (result.exitCode !== 0) {
      throw new Error(`Install script failed: ${result.stderr.toString()}`)
    }
  }

  function buildUpdateScript(installDir: string, binBaseUrl: string, target: string): string {
    return `#!/usr/bin/env bash
set -euo pipefail
APP=markscode
BIN_BASE_URL=${binBaseUrl}
INSTALL_DIR="${installDir}"
mkdir -p "\$INSTALL_DIR"

raw_os=$(uname -s)
os=$(echo "\$raw_os" | tr '[:upper:]' '[:lower:]')
case "\$raw_os" in
  Darwin*) os="darwin" ;;
  Linux*) os="linux" ;;
  MINGW*|MSYS*|CYGWIN*) os="windows" ;;
esac

arch=$(uname -m)
[ "\$arch" = "aarch64" ] && arch="arm64"
[ "\$arch" = "x86_64" ] && arch="x64"

if [ "\$os" = "darwin" ] && [ "\$arch" = "x64" ]; then
  rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
  [ "\$rosetta_flag" = "1" ] && arch="arm64"
fi

combo="\$os-\$arch"
case "\$combo" in
  linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64) ;;
  *) echo "Unsupported OS/Arch: \$os/\$arch"; exit 1 ;;
esac

is_musl=false
[ "\$os" = "linux" ] && {
  [ -f /etc/alpine-release ] && is_musl=true
  if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
    is_musl=true
  fi
}

needs_baseline=false
if [ "\$arch" = "x64" ]; then
  [ "\$os" = "linux" ] && ! grep -qwi avx2 /proc/cpuinfo 2>/dev/null && needs_baseline=true
  [ "\$os" = "darwin" ] && { avx2=$(sysctl -n hw.optional.avx2_0 2>/dev/null || echo 0); [ "\$avx2" != "1" ] && needs_baseline=true; }
  [ "\$os" = "windows" ] && {
    ps="(Add-Type -MemberDefinition \\\\"[DllImport(\\\\"kernel32.dll\\\\")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);\\\\" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)"
    out=""
    command -v powershell.exe >/dev/null 2>&1 && out=\$(powershell.exe -NoProfile -NonInteractive -Command "\$ps" 2>/dev/null || true)
    command -v pwsh >/dev/null 2>&1 && out=\$(pwsh -NoProfile -NonInteractive -Command "\$ps" 2>/dev/null || true)
    out=\$(echo "\$out" | tr -d '\\\\r' | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
    [ "\$out" != "true" ] && [ "\$out" != "1" ] && needs_baseline=true
  }
fi

target_dir="\$os-\$arch"
[ "\$needs_baseline" = "true" ] && target_dir="\${target_dir}-baseline"
[ "\$is_musl" = "true" ] && target_dir="\${target_dir}-musl"

filename="\$APP-\$target_dir.tar.gz"
[ "\$os" != "linux" ] && filename="\$APP-\$target_dir.zip"
url="\${BIN_BASE_URL}/v${target}/\$filename"

tmp_dir="/tmp/markscode_update_$$"
mkdir -p "\$tmp_dir"
archive="\$tmp_dir/\$filename"

echo "Downloading \$url"
if ! curl -fsSL "\$url" -o "\$archive"; then
  echo "Failed to download \$url"
  exit 1
fi

if [ "\$os" = "linux" ]; then
  if tar -tzf "\$archive" >/dev/null 2>&1; then
    tar -xzf "\$archive" -C "\$tmp_dir"
    found=$(find "\$tmp_dir" -type f -name "\$APP" | head -1)
    if [ -n "\$found" ]; then
      cp "\$found" "\$INSTALL_DIR/\$APP"
      chmod 755 "\$INSTALL_DIR/\$APP"
    fi
  elif tar -tJf "\$archive" >/dev/null 2>&1; then
    tar -xJf "\$archive" -C "\$tmp_dir"
    found=$(find "\$tmp_dir" -type f -name "\$APP" | head -1)
    if [ -n "\$found" ]; then
      cp "\$found" "\$INSTALL_DIR/\$APP"
      chmod 755 "\$INSTALL_DIR/\$APP"
    fi
  fi
else
  if unzip -tq "\$archive" >/dev/null 2>&1; then
    unzip -q "\$archive" -d "\$tmp_dir"
    found=$(find "\$tmp_dir" -type f -name "\$APP" | head -1)
    if [ -n "\$found" ]; then
      cp "\$found" "\$INSTALL_DIR/\$APP"
      chmod 755 "\$INSTALL_DIR/\$APP"
    fi
  fi
fi

rm -rf "\$tmp_dir"
echo "Installation complete"
`
  }

  async function runPackageUpdate(pkg: "npm" | "bun" | "pnpm", target: string): Promise<void> {
    const result = await $`${pkg} install -g markscode-ai@${target}`.nothrow()
    if (result.exitCode !== 0) {
      throw new Error(`${pkg} install failed: ${result.stderr.toString()}`)
    }
  }

  async function runBrewUpdate(target: string): Promise<void> {
    const formula = await getBrewFormula()
    const baseCmd = formula.includes("/")
      ? `brew tap anomalyco/tap && cd "$(brew --repo anomalyco/tap)" && git pull --ff-only && brew upgrade ${formula}`
      : `brew upgrade ${formula}`

    const result = await $`${baseCmd}`.env({ HOMEBREW_NO_AUTO_UPDATE: "1" }).nothrow()
    if (result.exitCode !== 0) {
      throw new Error(`Homebrew upgrade failed: ${result.stderr.toString()}`)
    }
  }

  async function getBrewFormula(): Promise<string> {
    const tapFormula = await $`brew list --formula anomalyco/tap/markscode`.throws(false).quiet().text()
    if (tapFormula.includes("markscode")) return "anomalyco/tap/markscode"
    const coreFormula = await $`brew list --formula markscode`.throws(false).quiet().text()
    if (coreFormula.includes("markscode")) return "markscode"
    return "markscode"
  }

  async function runChocoUpdate(target: string): Promise<void> {
    const result = await $`echo Y | choco upgrade markscode --version=${target}`.nothrow()
    if (result.exitCode !== 0) {
      throw new Error(`Chocolatey upgrade failed: ${result.stderr.toString()}`)
    }
  }

  async function runScoopUpdate(target: string): Promise<void> {
    const result = await $`scoop install markscode@${target}`.nothrow()
    if (result.exitCode !== 0) {
      throw new Error(`Scoop install failed: ${result.stderr.toString()}`)
    }
  }

  export async function rollbackToLatestBackup(): Promise<{
    success: boolean
    backupPath?: string
    error?: string
  }> {
    try {
      const backups = await Backup.listBackups()
      if (backups.length === 0) {
        return { success: false, error: "No backups found" }
      }

      const latestBackup = backups.sort().reverse()[0]
      await Backup.restoreBackup(latestBackup)
      
      log.info("rollback completed", { backup: latestBackup })
      return { success: true, backupPath: latestBackup }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("rollback failed", { error: message })
      return { success: false, error: message }
    }
  }
}
