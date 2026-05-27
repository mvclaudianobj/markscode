import { $ } from "bun"
import * as Log from "@opencode-ai/core/util/log"

export namespace Validate {
  const log = Log.create({ service: "update-validate" })

  async function isExecutable(binaryPath: string): Promise<boolean> {
    const result = await $`test -x ${binaryPath}`.nothrow()
    return result.exitCode === 0
  }

  async function checkBinaryType(binaryPath: string): Promise<string | null> {
    try {
      const result = await $`file ${binaryPath}`.nothrow().text()
      
      if (result.includes("ELF")) return "elf"
      if (result.includes("Mach-O")) return "mach-o"
      if (result.includes("PE32")) return "pe32"
      return "unknown"
    } catch {
      return null
    }
  }

  async function testBinaryRun(binaryPath: string): Promise<boolean> {
    try {
      const result = await $`${binaryPath} --version`.nothrow().quiet().text()
      return result.includes("markscode") || result.includes("MarksCode")
    } catch {
      return false
    }
  }

  async function calculateSHA256(binaryPath: string): Promise<string | undefined> {
    try {
      const result = await $`sha256sum ${binaryPath}`.nothrow().text()
      return result.split(" ")[0]
    } catch {
      return undefined
    }
  }

  async function verifyChecksum(binaryPath: string, expectedChecksum: string | undefined): Promise<boolean> {
    if (!expectedChecksum) return true
    
    try {
      const actual = await calculateSHA256(binaryPath)
      return actual?.toLowerCase() === expectedChecksum.toLowerCase()
    } catch {
      return false
    }
  }

  export async function validateBinary(binaryPath: string, expectedChecksum?: string): Promise<{
    valid: boolean
    errors: string[]
    checksum?: string
    type?: string
  }> {
    const errors: string[] = []

    log.info("validating binary", { binaryPath })

    const exists = await $`test -f ${binaryPath}`.quiet().nothrow()
    if (!exists) {
      errors.push("Binary file does not exist")
      return { valid: false, errors }
    }

    const executable = await isExecutable(binaryPath)
    if (!executable) {
      errors.push("Binary is not executable")
    }

    const type = await checkBinaryType(binaryPath)
    if (!type || type === "unknown") {
      errors.push("Binary type could not be determined or is unknown")
    }

    const checksumValid = await verifyChecksum(binaryPath, expectedChecksum)
    if (!checksumValid) {
      errors.push("Checksum verification failed")
    }

    const runs = await testBinaryRun(binaryPath)
    if (!runs) {
      errors.push("Binary fails to execute properly")
    }

    const checksum = await calculateSHA256(binaryPath)

    const result = {
      valid: errors.length === 0,
      errors,
      ...(checksum && { checksum }),
      ...(type && type !== "unknown" && { type }),
    }

    if (result.valid) {
      log.info("validation passed", { binaryPath, checksum, type })
    } else {
      log.error("validation failed", { binaryPath, errors })
    }

    return result
  }

  export async function validateDownloadedArchive(archivePath: string): Promise<boolean> {
    log.info("validating archive", { archivePath })

    try {
      const exists = await $`test -f ${archivePath}`.quiet().nothrow()
      if (!exists) {
        log.error("archive not found", { archivePath })
        return false
      }

      const result = await $`file ${archivePath}`.nothrow().text()
      
      if (result.includes("empty")) {
        log.error("archive is empty", { archivePath })
        return false
      }

      if (result.includes("HTML document")) {
        log.error("archive appears to be HTML (likely error page)", { archivePath })
        return false
      }

      const isArchive = 
        result.includes("Zip archive data") ||
        result.includes("gzip compressed data") ||
        result.includes("XZ compressed data") ||
        result.includes("tar archive")

      if (!isArchive) {
        log.error("file is not a recognized archive format", { type: result })
        return false
      }

      log.info("archive validation passed", { type: result.trim() })
      return true
    } catch (error) {
      log.error("archive validation error", { error, archivePath })
      return false
    }
  }
}
