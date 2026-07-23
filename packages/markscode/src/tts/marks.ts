import { TuiAudio } from "@/cli/cmd/tui/util/audio"

export type MarksTTSConfigSource = {
  get<T>(key: string, fallback?: T): T | undefined
}

const ignoredPartRe = /reasoning|thought|thinking|summary|metadata|meta/i
const g4fSpaceVoices = new Set([
  "gpt-audio",
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
  "coral",
  "verse",
  "ballad",
  "ash",
  "sage",
  "marin",
  "cedar",
  "amuch",
  "dan",
  "elan",
  "breeze",
  "cove",
  "ember",
  "fathom",
  "glimmer",
  "harp",
  "juniper",
  "maple",
  "orbit",
  "vale",
])

const valueFrom = <T>(config: { kv?: MarksTTSConfigSource } | undefined, key: string, env: string, fallback: T) =>
  config?.kv?.get<T>(key, fallback) ?? (process.env[env] === undefined ? fallback : (process.env[env] as T))

const optionalValueFrom = (config: { kv?: MarksTTSConfigSource } | undefined, key: string, ...env: string[]) =>
  String(config?.kv?.get(key, "") || env.map((name) => process.env[name]).find((value) => value) || "")

const optionalValueFromKeys = (config: { kv?: MarksTTSConfigSource } | undefined, keys: string[], env: string[]) =>
  String(keys.map((key) => config?.kv?.get(key, "")).find((value) => value) || env.map((name) => process.env[name]).find((value) => value) || "")

const isRootOrSudo = () => process.getuid?.() === 0 || Boolean(process.env.SUDO_USER)

const desktopUser = (config: { kv?: MarksTTSConfigSource } | undefined) =>
  String(process.env.MARKSCODE_TTS_DESKTOP_USER || config?.kv?.get("markscode_tts_desktop_user", "") || process.env.SUDO_USER || "marcos")

const uidFromUser = (user: string) => {
  try {
    const result = Bun.spawnSync(["id", "-u", user], { stdout: "pipe", stderr: "ignore" })
    const uid = new TextDecoder().decode(result.stdout).trim()
    if (result.exitCode === 0 && /^\d+$/.test(uid)) return uid
    return ""
  } catch {
    return ""
  }
}

const desktopUid = (config: { kv?: MarksTTSConfigSource } | undefined, user: string) =>
  String(process.env.MARKSCODE_TTS_DESKTOP_UID || config?.kv?.get("markscode_tts_desktop_uid", "") || process.env.SUDO_UID || uidFromUser(user) || "1000")

const cleanText = (value: string, maxChars: number) =>
  value
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, " ")
    .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, " ")
    .replace(/^\s*(?:Thought|Thinking|Raciocínio|Pensamento)\s*:.*$/gim, " ")
    .replace(/^\s*(?:[✱→▣]|[-+*]\s*(?:Thought|Thinking|Raciocínio|Pensamento)\s*:).*$|^\s*(?:grep|glob|read|task|tool|command)\s*(?:status|output|log)?\s*:.*$/gim, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/^\s*(?:[-+*]\s+)?(?:[\w./~-]+\.(?:ts|tsx|js|jsx|json|md|py|go|rs|sh|yml|yaml|toml|lock)|[>$]\s+|npm |bun |pnpm |yarn |git |curl |ssh |scp ).*$/gim, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars)

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object"

const isIgnoredPart = (part: Record<string, unknown>) =>
  [part.type, part.name, part.kind, part.category, part.role, part.label]
    .filter((value): value is string => typeof value === "string")
    .some((value) => ignoredPartRe.test(value))

const chunkText = (text: string, size: number) =>
  text
    .split(/(?<=[.!?…。！？])\s+|\n+/u)
    .flatMap((sentence) => {
      if (sentence.length <= size) return [sentence]
      return sentence.split(/\s+/).reduce<string[]>((chunks, word) => {
        const last = chunks.at(-1) || ""
        if (!last) return [word]
        if ((last + " " + word).length <= size) return [...chunks.slice(0, -1), last + " " + word]
        return [...chunks, word]
      }, [])
    })
    .reduce<string[]>((chunks, sentence) => {
      const trimmed = sentence.trim()
      if (!trimmed) return chunks
      const last = chunks.at(-1) || ""
      if (!last) return [trimmed]
      if ((last + " " + trimmed).length <= size) return [...chunks.slice(0, -1), last + " " + trimmed]
      return [...chunks, trimmed]
    }, [])

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isEnabled = (value: string) => /^(1|true|yes|on)$/i.test(value.trim())

const audioBaseFrom = (base: string, config: { kv?: MarksTTSConfigSource } | undefined) => {
  const trimmed = base.replace(/\/+$/, "")
  if (isEnabled(optionalValueFrom(config, "markscode_tts_g4f_space_v1_audio", "MARKS_G4F_SPACE_V1_AUDIO", "MARKSCODE_TTS_G4F_SPACE_V1_AUDIO"))) return trimmed
  return trimmed.replace(/\/v1$/i, "")
}

const g4fSpaceAudioResponse = (url: string, timeout: number, token?: string) =>
  fetch(url, {
    headers: new Headers({
      "user-agent": "Mozilla/5.0",
      accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
      ...(token ? { authorization: "Bearer " + token } : {}),
    }),
    signal: AbortSignal.timeout(timeout),
  })

const g4fGeminiAudioResponse = (url: string, chunk: string, voice: string, timeout: number) =>
  fetch(url, {
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      accept: "audio/mpeg,audio/ogg,audio/*;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0",
    }),
    body: JSON.stringify({ input: chunk, model: "", voice, response_format: "mp3", download_media: true }),
    signal: AbortSignal.timeout(timeout),
  })

const audioExtensionFrom = (bytes: Uint8Array, contentType: string) => {
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return ".ogg"
  if (/wav/i.test(contentType)) return ".wav"
  return ".mp3"
}

type TTSPlayer = "auto" | "native" | "ffplay" | "mpv" | "paplay" | "aplay" | "marcos-pulse" | "none"
type TTSProvider = "orbit-fallback" | "g4f-space" | "g4f-gemini"
type TTSStep = { provider: string; response: () => Promise<Response> }

const ttsPlayers = new Set<TTSPlayer>(["auto", "native", "ffplay", "mpv", "paplay", "aplay", "marcos-pulse", "none"])
let ttsSequence = 0
let ttsQueue = Promise.resolve()
let ttsGeneration = 0
let ttsRateLimitedUntil = 0
let currentPlayer: ReturnType<typeof Bun.spawn> | undefined
let currentVoice: Parameters<typeof TuiAudio.stopVoice>[0] | undefined

const playerCommand = (player: Exclude<TTSPlayer, "auto" | "native" | "none">, file: string, config?: { kv?: MarksTTSConfigSource }) =>
  player === "ffplay"
    ? ["ffplay", "-nodisp", "-autoexit", "-loglevel", "error", file]
    : player === "mpv"
      ? ["mpv", "--no-video", "--really-quiet", file]
      : player === "marcos-pulse"
        ? ((user) => [
            "runuser",
            "-u",
            user,
            "--",
            "env",
            "XDG_RUNTIME_DIR=/run/user/" + desktopUid(config, user),
            "PULSE_SERVER=unix:/run/user/" + desktopUid(config, user) + "/pulse/native",
            "ffplay",
            "-nodisp",
            "-autoexit",
            "-loglevel",
            "error",
            file,
          ])(desktopUser(config))
        : [player, file]

async function playNative(bytes: Uint8Array, file: string, text: string) {
  const sound = await TuiAudio.loadSoundBytes(bytes, file)
  if (!sound) return false
  const voice = TuiAudio.play(sound)
  if (!voice) return false
  currentVoice = voice
  try {
    await sleep(Math.min(8_000, Math.max(1_200, text.length * 80)))
    return true
  } finally {
    if (currentVoice === voice) currentVoice = undefined
  }
}

async function runPlayer(player: Exclude<TTSPlayer, "auto" | "native" | "none">, file: string, config?: { kv?: MarksTTSConfigSource }) {
  try {
    const proc = Bun.spawn(playerCommand(player, file, config), { stdout: "ignore", stderr: "ignore" })
    currentPlayer = proc
    return (await proc.exited) === 0
  } catch {
    return false
  } finally {
    currentPlayer = undefined
  }
}

async function playWithFallback(file: string, bytes: Uint8Array, text: string, config?: { kv?: MarksTTSConfigSource }) {
  const configured = String(valueFrom(config, "markscode_tts_player", "MARKSCODE_TTS_PLAYER", "auto"))
  const player = ttsPlayers.has(configured as TTSPlayer) ? (configured as TTSPlayer) : "auto"
  if (player === "none") return
  const players = player === "auto" ? (isRootOrSudo() ? (["marcos-pulse", "ffplay", "mpv", "paplay", "aplay"] as const) : (["native", "ffplay", "mpv", "paplay", "aplay", "marcos-pulse"] as const)) : [player]
  const played = await Array.from(players).reduce(
    (previous, current) =>
      previous.then(async (done) => {
        if (done) return true
        if (current === "native") return playNative(bytes, file, text)
        return runPlayer(current, file, config)
      }),
    Promise.resolve(false),
  )
  if (!played) throw new Error("Marks TTS playback failed")
}

async function synthesizeWithFallback(steps: TTSStep[], config: { kv?: MarksTTSConfigSource }) {
  const results = await steps.reduce(
    (previous, step) =>
      previous.then(async (attempts) => {
        if (attempts.some((attempt) => attempt.response?.ok)) return attempts
        try {
          const response = await step.response()
          return [...attempts, { provider: step.provider, status: response.status, response }]
        } catch {
          return [...attempts, { provider: step.provider, status: 0 }]
        }
      }),
    Promise.resolve([] as { provider: string; status: number; response?: Response }[]),
  )
  const success = results.find((result) => result.response?.ok)
  if (success?.response) return success.response
  if (results.length > 0 && results.every((result) => result.status === 429)) ttsRateLimitedUntil = Date.now() + Math.max(1, Number(valueFrom(config, "markscode_tts_rate_limit_cooldown_ms", "MARKSCODE_TTS_RATE_LIMIT_COOLDOWN_MS", 60000)) || 60000)
  const last = results.at(-1)
  throw new Error("Marks TTS synthesis failed" + (last ? ": " + last.provider + " " + String(last.status) : ""))
}

export function textFromParts(parts: unknown[], config?: { kv?: MarksTTSConfigSource }) {
  return cleanText(
    parts
      .flatMap((part) => {
        if (!isRecord(part)) return []
        if (part.synthetic || part.ignored || isIgnoredPart(part)) return []
        if (part.type === "text" && typeof part.text === "string") return [part.text]
        return []
      })
      .join("\n\n"),
    Math.max(1, Number(valueFrom(config, "markscode_tts_max_chars", "MARKSCODE_TTS_MAX_CHARS", 3000)) || 3000),
  )
}

export function streamableTextFromParts(parts: unknown[], config?: { kv?: MarksTTSConfigSource; minChars?: number; maxChars?: number }) {
  const maxChars = Math.max(1, Number(config?.maxChars ?? valueFrom(config, "markscode_tts_max_chars", "MARKSCODE_TTS_MAX_CHARS", 3000)) || 3000)
  const minChars = Math.max(1, Number(config?.minChars ?? valueFrom(config, "markscode_tts_stream_min_chars", "MARKSCODE_TTS_STREAM_MIN_CHARS", 120)) || 120)
  const text = textFromParts(parts, { kv: config?.kv }).slice(0, maxChars)
  const readyEnd = Array.from(text.matchAll(/[.!?…。！？:;](?=\s|$)|\n{2,}/gu)).reduce((last, match) => {
    const end = (match.index ?? 0) + match[0].length
    if (text.slice(0, end).trim().length < minChars) return last
    return end
  }, 0)
  const ready = text.slice(0, readyEnd).trim()
  if (ready.length < minChars) return ""
  return ready
}

async function speakNow(text: string, config: { kv?: MarksTTSConfigSource; messageID?: string; sequence: number; generation: number }) {
  const provider = String(valueFrom(config, "markscode_tts_provider", "MARKSCODE_TTS_PROVIDER", "g4f-space"))
  if (provider !== "orbit-fallback" && provider !== "g4f-gemini" && provider !== "g4f-space") throw new Error("Only orbit-fallback, g4f-gemini and g4f-space are supported")
  const voice = String(valueFrom(config, "markscode_tts_voice", "MARKSCODE_TTS_VOICE", "orbit"))
  if (!g4fSpaceVoices.has(voice)) throw new Error("Invalid g4f-space voice")
  const chunks = chunkText(text, Math.max(20, Number(valueFrom(config, "markscode_tts_chunk_size", "MARKSCODE_TTS_CHUNK_SIZE", 200)) || 200))
  const base = optionalValueFrom(config, "markscode_tts_g4f_space_url", "MARKS_G4F_SPACE_URL", "MARKSCODE_TTS_G4F_SPACE_URL") || "https://gpt4free.marks.ia.br"
  const directBase = optionalValueFrom(config, "markscode_tts_g4f_space_direct_url", "MARKSCODE_TTS_G4F_SPACE_DIRECT_URL") || "https://g4f.space"
  const directToken = optionalValueFromKeys(config, ["markscode_tts_g4f_space_token"], ["MARKSCODE_TTS_G4F_SPACE_TOKEN", "MARKS_G4F_SPACE_TOKEN"]) || "g4f_u_mrrcwq_be89ab5fc1bf69eccf958c1b7618e00f25fade9fcbf338e9_377260d6"
  const directToken2 = "g4f_u_mrrcwq_8c9541a138c6269b7e47f037c5e4997d3fc52d7e6a2d49e0_dd0ed2a3"
  const output = optionalValueFrom(config, "markscode_tts_output", "MARKSCODE_TTS_OUTPUT")
  const timeout = Math.max(1, Number(valueFrom(config, "markscode_tts_timeout", "MARKSCODE_TTS_TIMEOUT", 90)) || 90) * 1000
  const audioBase = audioBaseFrom(base, config)
  const directAudioBase = audioBaseFrom(directBase, config)
  await chunks.reduce(
    (previous, chunk, index) =>
      previous.then(async () => {
        if (config.generation !== ttsGeneration) return
        if (Date.now() < ttsRateLimitedUntil) return
        const directStep = directToken
          ? [{ provider: "g4f-space-direct", response: () => g4fSpaceAudioResponse(directAudioBase + "/ai/audio/" + encodeURIComponent(chunk) + "?voice=" + encodeURIComponent(voice), timeout, directToken) }]
          : []
        const directStep2 = [{ provider: "g4f-space-direct2", response: () => g4fSpaceAudioResponse(directAudioBase + "/ai/audio/" + encodeURIComponent(chunk) + "?voice=" + encodeURIComponent(voice), timeout, directToken2) }]
        const proxyStep = [{ provider: "g4f-space-proxy", response: () => g4fSpaceAudioResponse(audioBase + "/ai/audio/" + encodeURIComponent(chunk) + "?voice=" + encodeURIComponent(voice), timeout) }]
        const geminiStep = [{ provider: "g4f-gemini", response: () => g4fGeminiAudioResponse(audioBase + "/api/Gemini/audio/speech", chunk, voice, timeout) }]
        const providerSteps: TTSStep[] =
          provider === "g4f-gemini" ? geminiStep : provider === "g4f-space" ? (directToken ? [...directStep, ...directStep2] : [...directStep2, ...proxyStep]) : [...directStep, ...directStep2, ...proxyStep, ...geminiStep]
        const steps = provider === "g4f-space" && isEnabled(String(valueFrom(config, "markscode_tts_disable_provider_fallback", "MARKSCODE_TTS_DISABLE_PROVIDER_FALLBACK", "1"))) ? providerSteps.slice(0, 1) : providerSteps
        const response = await synthesizeWithFallback(steps, config)
        if (config.generation !== ttsGeneration) return
        const bytes = new Uint8Array(await response.arrayBuffer())
        const file = chunks.length === 1 && output ? output : "/tmp/markscode-tts-" + String(config.messageID ? config.messageID + "-seq" + String(config.sequence) + "-chunk" : "seq" + String(config.sequence)).replace(/[^A-Za-z0-9._-]/g, "_") + "-" + String(index) + audioExtensionFrom(bytes, response.headers.get("content-type") || "")
        await Bun.write(file, bytes)
        await playWithFallback(file, bytes, chunk, config)
      }),
    Promise.resolve(),
  )
}

export async function speak(text: string, config?: { kv?: MarksTTSConfigSource; messageID?: string }) {
  if (!text.trim()) return
  const sequence = ++ttsSequence
  const generation = ttsGeneration
  const task = ttsQueue.then(() => (generation === ttsGeneration ? speakNow(text, { ...config, sequence, generation }) : undefined))
  ttsQueue = task.catch(() => {})
  return task
}

export function stop() {
  ttsGeneration++
  ttsQueue = Promise.resolve()
  try {
    currentPlayer?.kill()
  } catch {}
  currentPlayer = undefined
  if (currentVoice) TuiAudio.stopVoice(currentVoice)
  currentVoice = undefined
}

export * as MarksTTS from "./marks"
