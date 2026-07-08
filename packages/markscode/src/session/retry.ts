import type { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Clock, Duration, Effect, Schedule } from "effect"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"
import { isRecord } from "@/util/record"

export type Err = ReturnType<NamedError["toObject"]>

export const GO_UPSELL_MESSAGE = "Free usage exceeded, subscribe to Go"
export const GO_UPSELL_URL = "https://opencode.ai/go"
export type RetryReason = "free_tier_limit" | "account_rate_limit" | (string & {})

export type Retryable = {
  message: string
  action?: {
    reason: RetryReason
    provider: string
    title: string
    message: string
    label: string
    link?: string
  }
}

export const RETRY_INITIAL_DELAY = 2000
export const RETRY_BACKOFF_FACTOR = 2
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout

function cap(ms: number) {
  return Math.min(ms, RETRY_MAX_DELAY)
}

export function delay(attempt: number, error?: MessageV2.APIError) {
  if (error) {
    const headers = error.data.responseHeaders
    if (headers) {
      const retryAfterMs = headers["retry-after-ms"]
      if (retryAfterMs) {
        const parsedMs = Number.parseFloat(retryAfterMs)
        if (!Number.isNaN(parsedMs)) {
          return cap(parsedMs)
        }
      }

      const retryAfter = headers["retry-after"]
      if (retryAfter) {
        const parsedSeconds = Number.parseFloat(retryAfter)
        if (!Number.isNaN(parsedSeconds)) {
          // convert seconds to milliseconds
          return cap(Math.ceil(parsedSeconds * 1000))
        }
        // Try parsing as HTTP date format
        const parsed = Date.parse(retryAfter) - Date.now()
        if (!Number.isNaN(parsed) && parsed > 0) {
          return cap(Math.ceil(parsed))
        }
      }

      return cap(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1))
    }
  }

  return cap(Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS))
}

export function retryable(error: Err, provider: string) {
  // context overflow errors should not be retried
  if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    // 5xx errors are transient server failures and should always be retried,
    // even when the provider SDK doesn't explicitly mark them as retryable.
    if (!error.data.isRetryable && !(status !== undefined && status >= 500)) return undefined
    if (error.data.responseBody?.includes("FreeUsageLimitError")) {
      return {
        message: GO_UPSELL_MESSAGE,
        action: {
          reason: "free_tier_limit",
          provider,
          title: "Free limit reached",
          message: "Subscribe to OpenCode Go for reliable access to the best open-source models, starting at $5/month.",
          label: "subscribe",
          link: GO_UPSELL_URL,
        },
      }
    }
    if (error.data.responseBody?.includes("GoUsageLimitError")) {
      const body = parseJSON(error.data.responseBody)
      const workspace = str(body?.metadata?.workspace)
      const limitName = str(body?.metadata?.limitName)
      const retryAfter = num(error.data.responseHeaders?.["retry-after"])
      const resetIn = iife(() => {
        if (retryAfter === undefined) return ""
        const seconds = Math.max(0, Math.ceil(retryAfter))
        const days = Math.floor(seconds / 86_400)
        const hours = Math.floor((seconds % 86_400) / 3_600)
        const minutes = Math.ceil((seconds % 3_600) / 60)
        const unit = (value: number, name: string) => `${value} ${name}${value === 1 ? "" : "s"}`

        if (days > 0) return hours > 0 ? `${unit(days, "day")} ${unit(hours, "hour")}` : unit(days, "day")
        if (hours > 0) return minutes > 0 ? `${unit(hours, "hour")} ${unit(minutes, "minute")}` : unit(hours, "hour")
        return minutes > 0 ? unit(minutes, "minute") : "less than a minute"
      })

      const message = `${limitName ? `${limitName} usage limit` : "Usage limit"} reached. It will reset in ${resetIn}. To continue using this model now, enable usage from your available balance`

      const link = `https://opencode.ai/workspace/${workspace}/go`
      return {
        message: `${message} - ${link}`,
        action: {
          reason: "account_rate_limit",
          provider,
          title: "Go limit reached",
          message,
          label: "open settings",
          link,
        },
      }
    }
    return { message: error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message }
  }

  // Check for rate limit patterns in plain text error messages
  const msg = isRecord(error.data) ? error.data.message : undefined
  if (typeof msg === "string") {
    const lower = msg.toLowerCase()
    if (
      lower.includes("rate increased too quickly") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests")
    ) {
      return { message: msg }
    }
  }

  const json = parseJSON(msg)
  if (!json || typeof json !== "object") return undefined
  const code = typeof json.code === "string" ? json.code : ""

  if (json.type === "error" && json.error?.type === "too_many_requests") {
    return { message: "Too Many Requests" }
  }
  if (code.includes("exhausted") || code.includes("unavailable")) {
    return { message: "Provider is overloaded" }
  }
  if (json.type === "error" && typeof json.error?.code === "string" && json.error.code.includes("rate_limit")) {
    return { message: "Rate Limited" }
  }
  return undefined
}

export function isRateLimit(error: Err) {
  if (MessageV2.APIError.isInstance(error)) {
    if (error.data.statusCode === 429) return true
    return rateLimitText(error.data.message) || rateLimitText(error.data.responseBody)
  }
  const msg = isRecord(error.data) ? error.data.message : undefined
  if (rateLimitText(msg)) return true
  const json = parseJSON(msg)
  if (!json || typeof json !== "object") return false
  if (json.type === "error" && json.error?.type === "too_many_requests") return true
  if (json.type === "error" && typeof json.error?.code === "string" && json.error.code.includes("rate_limit")) {
    return true
  }
  return typeof json.code === "string" && json.code.includes("rate_limit")
}

export function shouldFallbackModel(input: { agent?: string; assistantAgent?: string; alreadyUsed: boolean; error: Err }) {
  if (input.alreadyUsed) return false
  if (input.agent !== "orchestrator" && input.assistantAgent !== "orchestrator") return false
  return isProviderLimit(input.error)
}

export function isProviderLimit(error: Err) {
  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    if (status === 429 || status === 402 || status === 403) return true
    if (typeof error.data.responseBody === "string" && limitText(error.data.responseBody)) return true
    if (typeof error.data.message === "string" && limitText(error.data.message)) return true
  }
  if (isRecord(error) && typeof (error as Record<string, unknown>).statusCode === "number") {
    const sc = (error as Record<string, unknown>).statusCode as number
    if (sc === 429 || sc === 402 || sc === 403) return true
    if (typeof (error as Record<string, unknown>).responseBody === "string" && limitText((error as Record<string, unknown>).responseBody as string)) return true
    if (typeof (error as Record<string, unknown>).message === "string" && limitText((error as Record<string, unknown>).message as string)) return true
  }
  const dataErr = isRecord(error.data) ? error.data : (isRecord(error) ? error : undefined)
  const msg = isRecord(dataErr) ? (dataErr as Record<string, unknown>).message : undefined
  if (typeof msg === "string" && limitText(msg)) return true
  const body = parseJSON(msg) as Record<string, unknown> | undefined
  if (!body || typeof body !== "object") return false
  const code = typeof body.code === "string" ? (body.code as string) : ""
  if (code.includes("rate_limit") || code.includes("exhausted") || code.includes("insufficient_quota") || code.includes("usage_not_included") || code.includes("timeout")) return true
  const err = body.error
  const errCode = typeof err === "object" && err !== null ? (err as Record<string, unknown>).code : undefined
  if (typeof errCode === "string" && (errCode.includes("rate_limit") || errCode.includes("insufficient_quota") || errCode.includes("exhausted") || errCode.includes("timeout") || errCode.includes("usage_not_included"))) return true
  return false
}

function rateLimitText(value: unknown) {
  if (typeof value !== "string") return false
  const lower = value.toLowerCase()
  return (
    lower.includes("rate increased too quickly") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("too_many_requests")
  )
}

function limitText(value: string) {
  const lower = value.toLowerCase()
  return (
    lower.includes("rate increased too quickly") ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("too_many_requests") ||
    lower.includes("quota") ||
    lower.includes("insufficient_quota") ||
    lower.includes("usage limit") ||
    lower.includes("usage_not_included") ||
    lower.includes("token limit") ||
    lower.includes("tokens exhausted") ||
    lower.includes("exhausted") ||
    lower.includes("credit") ||
    lower.includes("billing") ||
    lower.includes("time limit") ||
    lower.includes("timeout") ||
    lower.includes("timed out")
  )
}

function str(value: unknown) {
  if (value === undefined || value === null) return ""
  return String(value)
}

function num(value: unknown) {
  const parsed = Number.parseFloat(str(value))
  if (Number.isNaN(parsed)) return undefined
  return parsed
}

function parseJSON(value: unknown) {
  return iife(() => {
    try {
      if (typeof value !== "string") return undefined
      return JSON.parse(value)
    } catch {
      return undefined
    }
  })
}

export function policy(opts: {
  provider: string
  parse: (error: unknown) => Err
  set: (input: {
    attempt: number
    message: string
    action?: Retryable["action"]
    next: number
    error: Err
  }) => Effect.Effect<void>
}) {
  return Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
      const error = opts.parse(meta.input)
      const retry = retryable(error, opts.provider)
      if (!retry) return Cause.done(meta.attempt)
      return Effect.gen(function* () {
        const wait = delay(meta.attempt, MessageV2.APIError.isInstance(error) ? error : undefined)
        const now = yield* Clock.currentTimeMillis
        yield* opts.set({
          attempt: meta.attempt,
          message: retry.message,
          action: retry.action,
          next: now + wait,
          error,
        })
        return [meta.attempt, Duration.millis(wait)] as [number, Duration.Duration]
      })
    }),
  )
}

export * as SessionRetry from "./retry"
