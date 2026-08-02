import { getMarksAgentConfigValue, getMarksAgentSecretValue } from "../marks-agent-config-source"

export type MarksSTTConfigSource = {
  get<T>(key: string, fallback?: T): T | undefined
}

type STTRecorder = "ffmpeg" | "arecord" | "sox"

type STTProvider = "auto" | "faster-whisper" | "whisper-cpp"

const recorders = new Set<STTRecorder>(["ffmpeg", "arecord", "sox"])

const providers = new Set<STTProvider>(["auto", "faster-whisper", "whisper-cpp"])

export const defaultSttServerUrl = "http://127.0.0.1:38087"

const marksAgentValue = (env: string[]) => env.map((name) => getMarksAgentConfigValue(name) || getMarksAgentSecretValue(name)).find((value) => value !== undefined)

const valueFrom = <T>(config: { kv?: MarksSTTConfigSource } | undefined, key: string, env: string, fallback: T) => {
  const configured = config?.kv?.get<T>(key)
  if (configured !== undefined) return configured
  const agent = marksAgentValue([env])
  if (agent !== undefined) return agent as T
  return process.env[env] === undefined ? fallback : (process.env[env] as T)
}

const optionalValueFrom = (config: { kv?: MarksSTTConfigSource } | undefined, key: string, ...env: string[]) =>
  String(config?.kv?.get(key, "") || marksAgentValue(env) || env.map((name) => process.env[name]).find((value) => value) || "")

const isRootOrSudo = () => process.getuid?.() === 0 || Boolean(process.env.SUDO_USER)

const desktopUser = (config: { kv?: MarksSTTConfigSource } | undefined) =>
  String(
    optionalValueFrom(config, "markscode_stt_desktop_user", "MARKSCODE_STT_DESKTOP_USER") ||
      optionalValueFrom(config, "markscode_tts_desktop_user", "MARKSCODE_TTS_DESKTOP_USER") ||
      process.env.SUDO_USER ||
      "marcos",
  )

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

const desktopUid = (config: { kv?: MarksSTTConfigSource } | undefined, user: string) =>
  String(
    optionalValueFrom(config, "markscode_stt_desktop_uid", "MARKSCODE_STT_DESKTOP_UID") ||
      optionalValueFrom(config, "markscode_tts_desktop_uid", "MARKSCODE_TTS_DESKTOP_UID") ||
      process.env.SUDO_UID ||
      uidFromUser(user) ||
      "1000",
  )

const homeCandidates = (config: { kv?: MarksSTTConfigSource } | undefined) =>
  Array.from(new Set([process.env.HOME || "", isRootOrSudo() ? "/home/" + desktopUser(config) : ""].filter(Boolean)))

const expandHome = (path: string, config: { kv?: MarksSTTConfigSource } | undefined) =>
  path === "~" ? homeCandidates(config) : path.startsWith("~/") ? homeCandidates(config).map((home) => home + path.slice(1)) : [path]

const localWhisperfile = "/media/marcos/Arquivos/projetos/marks/ecosystem/systems/marks-cpu-llm/data/llamafile/whisperfile-0.10.3"

const localWhisperModel = "/media/marcos/Arquivos/projetos/marks/ecosystem/systems/marks-cpu-llm/data/models/whisper/ggml-base.bin"

const defaultModelCandidates = (config?: { kv?: MarksSTTConfigSource }) =>
  Array.from(
    new Set(
      [
        optionalValueFrom(config, "markscode_stt_model", "MARKSCODE_STT_MODEL"),
        "~/.cache/markscode/whisper/ggml-base.bin",
        "~/.cache/markscode/whisper/ggml-base.pt.bin",
        "~/.cache/whisper.cpp/ggml-base.bin",
        "~/.cache/whisper/ggml-base.bin",
        "~/models/whisper/ggml-base.bin",
        localWhisperModel,
        "/usr/local/share/whisper/ggml-base.bin",
        "/usr/share/whisper/ggml-base.bin",
      ]
        .filter(Boolean)
        .flatMap((path) => expandHome(path, config)),
    ),
  )

const commandExists = async (command: string) => {
  const bun = Bun as typeof Bun & { which?: (command: string) => string | null | Promise<string | null> }
  if (bun.which) return Boolean(await bun.which(command))
  try {
    return (await Bun.spawn(["which", command], { stdout: "ignore", stderr: "ignore" }).exited) === 0
  } catch {
    return false
  }
}

const splitCommand = (command: string) => command.trim().split(/\s+/).filter(Boolean)

const commandAvailable = async (argv: string[]) => argv.length > 0 && (argv[0].includes("/") ? await Bun.file(argv[0]).exists() : await commandExists(argv[0]))

type WhisperCommandCandidate = {
  argv: string[]
  explicit?: boolean
}

const describeCommand = (argv: string[]) => argv.join(" ")

const validateWhisperCommand = async (argv: string[]) => {
  if (!(await commandAvailable(argv))) return "comando não encontrado: " + describeCommand(argv)
  try {
    const proc = Bun.spawn([...argv, "--help"], { stdout: "ignore", stderr: "ignore" })
    const code = await Promise.race([
      proc.exited.catch(() => 1),
      new Promise<number>((resolve) =>
        setTimeout(() => {
          proc.kill()
          resolve(124)
        }, 3_000),
      ),
    ])
    return code === 0 ? "" : "validação --help falhou para " + describeCommand(argv) + " (exit code " + String(code) + ")"
  } catch (error) {
    return "validação --help falhou para " + describeCommand(argv) + ": " + (error instanceof Error ? error.message : String(error))
  }
}

const defaultCommandCandidates = async (config?: { kv?: MarksSTTConfigSource }) =>
  [
    { argv: splitCommand(optionalValueFrom(config, "markscode_stt_whisper_command", "MARKSCODE_STT_WHISPER_COMMAND")), explicit: true },
    { argv: ["whisper-cli"] },
    { argv: ["whisper"] },
    { argv: ["sh", localWhisperfile] },
  ].filter((candidate) => candidate.argv.length > 0)

const firstAvailableWhisperCommand = async (config?: { kv?: MarksSTTConfigSource }) =>
  (await defaultCommandCandidates(config)).reduce(
    (previous, current) =>
      previous.then(async (found) => {
        if (found.length > 0) return found
        const error = await validateWhisperCommand(current.argv)
        if (!error) return current.argv
        if (current.explicit) throw new Error("MARKSCODE_STT_WHISPER_COMMAND falhou na validação: " + error)
        return []
      }),
    Promise.resolve<string[]>([]),
  )

const defaultServerCommandCandidates = async (config?: { kv?: MarksSTTConfigSource }) =>
  [
    { argv: splitCommand(optionalValueFrom(config, "markscode_stt_whisper_server_command", "MARKSCODE_STT_WHISPER_SERVER_COMMAND")), explicit: true },
    { argv: ["whisper-server"] },
    { argv: ["whisper.cpp-server"] },
  ].filter((candidate) => candidate.argv.length > 0)

const firstAvailableWhisperServerCommand = async (config?: { kv?: MarksSTTConfigSource }) =>
  (await defaultServerCommandCandidates(config)).reduce(
    (previous, current) =>
      previous.then(async (found) => {
        if (found.length > 0) return found
        const error = await validateWhisperCommand(current.argv)
        if (!error) return current.argv
        if (current.explicit) throw new Error("MARKSCODE_STT_WHISPER_SERVER_COMMAND falhou na validação: " + error)
        return []
      }),
    Promise.resolve<string[]>([]),
  )

const resolveWhisperModel = async (config?: { kv?: MarksSTTConfigSource }) =>
  defaultModelCandidates(config).reduce(
    (previous, current) => previous.then(async (found) => found || ((await Bun.file(current).exists()) ? current : "")),
    Promise.resolve(""),
  )

let managedSttServerProcess: ReturnType<typeof Bun.spawn> | undefined

const serverReachable = async (server: string) => {
  try {
    await fetch(server.replace(/\/+$/, ""), { method: "GET", signal: AbortSignal.timeout(800) })
    return true
  } catch {
    return false
  }
}

const waitForServer = async (server: string, deadline: number) => {
  const started = Date.now()
  return Array.from({ length: Math.ceil(deadline / 250) }).reduce(
    (previous: Promise<boolean>) =>
      previous.then(async (reachable: boolean) => {
        if (reachable) return true
        if (Date.now() - started >= deadline) return false
        await new Promise((resolve) => setTimeout(resolve, 250))
        return await serverReachable(server)
      }),
    Promise.resolve(false),
  )
}

const ensureManagedServer = async (config?: { kv?: MarksSTTConfigSource }) => {
  if (await serverReachable(defaultSttServerUrl)) return defaultSttServerUrl
  const command = await firstAvailableWhisperServerCommand(config)
  if (command.length === 0) return ""
  const model = await resolveWhisperModel(config)
  if (!model) return ""
  managedSttServerProcess = Bun.spawn([...command, "-m", model, "--host", "127.0.0.1", "--port", "38087"], { stdout: "ignore", stderr: "ignore" })
  managedSttServerProcess.exited.finally(() => {
    managedSttServerProcess = undefined
  })
  return (await waitForServer(defaultSttServerUrl, 5_000)) ? defaultSttServerUrl : ""
}

const run = async (cmd: string[], timeout: number) => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  let timer: ReturnType<typeof setTimeout> | undefined
  const code = await Promise.race([
    proc.exited,
    new Promise<number>((resolve) =>
      timer = setTimeout(() => {
        stopProcess(proc)
        resolve(124)
      }, timeout),
    ),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
  try {
    const stderr = new TextDecoder().decode(await new Response(proc.stderr).arrayBuffer()).trim()
    if (code !== 0) throw new Error(stderr || "Command failed: " + cmd[0])
  } finally {
    await stopProcess(proc)
  }
}

const fasterWhisperInstallHint =
  "faster-whisper não instalado. Para usar sem pip global: python3 -m venv ~/.cache/markscode/faster-whisper-venv && ~/.cache/markscode/faster-whisper-venv/bin/python -m pip install faster-whisper && MARKSCODE_STT_PYTHON=~/.cache/markscode/faster-whisper-venv/bin/python markscode"

const fasterWhisperAvailable = async (config?: { kv?: MarksSTTConfigSource }) => {
  try {
    return Bun.spawnSync([String(valueFrom(config, "markscode_stt_python", "MARKSCODE_STT_PYTHON", "python3")), "-c", "import faster_whisper"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0
  } catch {
    return false
  }
}

const waitForExit = async (proc: ReturnType<typeof Bun.spawn>, timeout: number) =>
  Promise.race([
    proc.exited.catch(() => 0),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeout)),
  ])

const stopProcess = async (proc: ReturnType<typeof Bun.spawn>) => {
  try {
    proc.kill("SIGINT")
  } catch {}
  if ((await waitForExit(proc, 1_500)) !== undefined) return
  try {
    proc.kill("SIGTERM")
  } catch {}
  if ((await waitForExit(proc, 800)) !== undefined) return
  try {
    proc.kill("SIGKILL")
  } catch {}
  await waitForExit(proc, 800)
}

const ffmpegPulseCommand = (file: string, seconds: number | undefined, config?: { kv?: MarksSTTConfigSource }) => {
  const cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", ...(seconds ? ["-t", String(seconds)] : []), "-f", "pulse", "-i", "default", "-ar", "16000", "-ac", "1", file]
  if (!isRootOrSudo()) return cmd
  const user = desktopUser(config)
  const uid = desktopUid(config, user)
  return ["runuser", "-u", user, "--", "env", "XDG_RUNTIME_DIR=/run/user/" + uid, "PULSE_SERVER=unix:/run/user/" + uid + "/pulse/native", ...cmd]
}

const recorderCommands = (recorder: STTRecorder, file: string, seconds: number, config?: { kv?: MarksSTTConfigSource }) =>
  recorder === "ffmpeg"
    ? [
        ffmpegPulseCommand(file, seconds, config),
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-t", String(seconds), "-f", "alsa", "-i", "default", "-ar", "16000", "-ac", "1", file],
      ]
    : recorder === "arecord"
      ? [["arecord", "-q", "-d", String(seconds), "-f", "S16_LE", "-r", "16000", "-c", "1", file]]
        : [["rec", "-q", "-r", "16000", "-c", "1", file, "trim", "0", String(seconds)]]

const captureCommands = (recorder: STTRecorder, file: string, seconds: number, config?: { kv?: MarksSTTConfigSource }) =>
  recorder === "ffmpeg"
    ? [
        ffmpegPulseCommand(file, seconds, config),
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-t", String(seconds), "-f", "alsa", "-i", "default", "-ar", "16000", "-ac", "1", file],
      ]
    : recorder === "arecord"
      ? [["arecord", "-q", "-d", String(seconds), "-f", "S16_LE", "-r", "16000", "-c", "1", file]]
      : [["rec", "-q", "-r", "16000", "-c", "1", file, "trim", "0", String(seconds)]]

const recordAudio = async (file: string, seconds: number, config?: { kv?: MarksSTTConfigSource }) => {
  const configured = optionalValueFrom(config, "markscode_stt_recorder", "MARKSCODE_STT_RECORDER")
  const candidates = configured ? [configured] : ["ffmpeg", "arecord", "sox"]
  const errors: string[] = []
  const ok = await candidates.reduce(
    (previous, current) =>
      previous.then(async (done) => {
        if (done) return true
        if (!recorders.has(current as STTRecorder)) {
          errors.push("Gravador STT inválido: " + current)
          return false
        }
        if (!(await commandExists(current === "sox" ? "rec" : current))) return false
        return recorderCommands(current as STTRecorder, file, seconds, config).reduce(
          (inner, cmd) =>
            inner.then(async (recorded) => {
              if (recorded) return true
              try {
                await run(cmd, Math.max(1, seconds + 5) * 1000)
                return true
              } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error))
                return false
              }
            }),
          Promise.resolve(false),
        )
      }),
    Promise.resolve(false),
  )
  if (!ok) throw new Error(errors.at(-1) || "Nenhum gravador local disponível para Marks STT")
}

const transcribeServer = async (file: string, server: string, language: string, timeout: number) => {
  const body = new FormData()
  body.append("file", Bun.file(file))
  body.append("response_format", "json")
  body.append("language", language)
  body.append("temperature", "0")
  const response = await fetch(server.replace(/\/+$/, "") + "/inference", { method: "POST", body, signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error("Marks STT server failed: " + String(response.status) + ". Configure MARKSCODE_STT_SERVER_URL=" + defaultSttServerUrl + " ou use whisper-server local na porta 38087.")
  const data = await response.json()
  if (typeof data.text === "string") return data.text.trim()
  if (typeof data.transcription === "string") return data.transcription.trim()
  if (typeof data.result === "string") return data.result.trim()
  if (Array.isArray(data.segments)) return data.segments.map((segment: { text?: unknown }) => (typeof segment.text === "string" ? segment.text : "")).join(" ").trim()
  return ""
}

const transcribeCli = async (file: string, language: string, config?: { kv?: MarksSTTConfigSource }) => {
  const model = await resolveWhisperModel(config)
  if (!model)
    throw new Error(
      "Modelo Whisper local não encontrado. Crie o diretório com `mkdir -p ~/.cache/markscode/whisper`, baixe o modelo base com `curl -L -o ~/.cache/markscode/whisper/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin` ou configure `MARKSCODE_STT_MODEL=/caminho/ggml-base.bin`.",
    )
  const command = await firstAvailableWhisperCommand(config)
  if (command.length === 0)
    throw new Error(
      'whisper-server na porta 38087 ou whisper-cli/whisper não encontrado; também tentei o whisperfile local. Instale whisper.cpp ou configure MARKSCODE_STT_WHISPER_SERVER_COMMAND="whisper-server" ou MARKSCODE_STT_WHISPER_COMMAND="sh /caminho/whisperfile".',
    )
  const outBase = file.replace(/\.wav$/, "")
  await run([...command, "-m", model, "-f", file, "-l", language, "-otxt", "-of", outBase, "-nt"], 300_000)
  if (!(await Bun.file(outBase + ".txt").exists())) return ""
  return (await Bun.file(outBase + ".txt").text()).trim()
}

const transcribeFasterWhisper = async (file: string, language: string, config?: { kv?: MarksSTTConfigSource }) => {
  const proc = Bun.spawn(
    [
      String(valueFrom(config, "markscode_stt_python", "MARKSCODE_STT_PYTHON", "python3")),
      "-c",
      `import json, sys
try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.stderr.write("${fasterWhisperInstallHint}")
    raise SystemExit(1)
try:
    model = WhisperModel(sys.argv[2], device=sys.argv[3], compute_type=sys.argv[4])
    segments, _ = model.transcribe(sys.argv[1], language=sys.argv[5], vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500), beam_size=1, condition_on_previous_text=False)
    print(json.dumps({"text": " ".join(segment.text.strip() for segment in segments).strip()}, ensure_ascii=False, separators=(",", ":")))
except Exception as error:
    sys.stderr.write(str(error))
    raise SystemExit(1)`,
      file,
      String(valueFrom(config, "markscode_stt_faster_model", "MARKSCODE_STT_FASTER_MODEL", "base")),
      String(valueFrom(config, "markscode_stt_faster_device", "MARKSCODE_STT_FASTER_DEVICE", "cpu")),
      String(valueFrom(config, "markscode_stt_faster_compute_type", "MARKSCODE_STT_FASTER_COMPUTE_TYPE", "int8")),
      language,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const code = await Promise.race([
    proc.exited,
    new Promise<number>((resolve) =>
      setTimeout(() => {
        proc.kill()
        resolve(124)
      }, 300_000),
    ),
  ])
  const stdout = new TextDecoder().decode(await new Response(proc.stdout).arrayBuffer()).trim()
  const stderr = new TextDecoder().decode(await new Response(proc.stderr).arrayBuffer()).trim()
  if (code !== 0) throw new Error(stderr || "faster-whisper STT failed")
  const data = JSON.parse(stdout || "{}")
  return typeof data.text === "string" ? data.text.trim() : ""
}

const sttProvider = (config?: { kv?: MarksSTTConfigSource }) => {
  const provider = String(valueFrom(config, "markscode_stt_provider", "MARKSCODE_STT_PROVIDER", "auto"))
  if (providers.has(provider as STTProvider)) return provider as STTProvider
  throw new Error("Provider STT inválido: " + provider + ". Valores aceitos: auto, faster-whisper, whisper-cpp")
}

const transcribeAudio = async (file: string, language: string, config?: { kv?: MarksSTTConfigSource }) => {
  const server = optionalValueFrom(config, "markscode_stt_server_url", "MARKSCODE_STT_SERVER_URL")
  if (server) return await transcribeServer(file, server, language, 300_000)
  const provider = sttProvider(config)
  if (provider === "whisper-cpp") return await transcribeCli(file, language, config)
  if (provider === "faster-whisper") return await transcribeFasterWhisper(file, language, config)
  try {
    const managedServer = await ensureManagedServer(config)
    if (managedServer) return await transcribeServer(file, managedServer, language, 300_000)
  } catch {}
  if ((await firstAvailableWhisperCommand(config)).length > 0) return await transcribeCli(file, language, config)
  if (await fasterWhisperAvailable(config)) return await transcribeFasterWhisper(file, language, config)
  return await transcribeCli(file, language, config)
}

export async function startCapture(config?: { kv?: MarksSTTConfigSource }) {
  sttProvider(config)
  const language = String(valueFrom(config, "markscode_stt_language", "MARKSCODE_STT_LANGUAGE", "pt"))
  const file = "/tmp/markscode-stt-" + Date.now() + ".wav"
  const seconds = Math.max(1, Number(valueFrom(config, "markscode_stt_capture_max_seconds", "MARKSCODE_STT_CAPTURE_MAX_SECONDS", 120)) || 120)
  const configured = optionalValueFrom(config, "markscode_stt_recorder", "MARKSCODE_STT_RECORDER")
  const candidates = configured ? [configured] : ["ffmpeg", "arecord", "sox"]
  const errors: string[] = []
  const started = await candidates.reduce(
    (previous, current) =>
      previous.then(async (found) => {
        if (found) return found
        if (!recorders.has(current as STTRecorder)) {
          errors.push("Gravador STT inválido: " + current)
          return undefined
        }
        if (!(await commandExists(current === "sox" ? "rec" : current))) return undefined
        return captureCommands(current as STTRecorder, file, seconds, config).reduce(
          (inner, cmd) =>
            inner.then(async (proc) => {
              if (proc) return proc
              try {
                return Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" })
              } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error))
                return undefined
              }
            }),
          Promise.resolve<ReturnType<typeof Bun.spawn> | undefined>(undefined),
        )
      }),
    Promise.resolve<ReturnType<typeof Bun.spawn> | undefined>(undefined),
  )
  if (!started) throw new Error(errors.at(-1) || "Nenhum gravador local disponível para Marks STT")
  const watchdog = setTimeout(() => {
    stopProcess(started)
  }, (seconds + 5) * 1000)
  watchdog.unref?.()
  return {
    stop: async () => {
      try {
        await stopProcess(started)
        if (!(await Bun.file(file).exists()) || Bun.file(file).size === 0) return ""
        return (await transcribeAudio(file, language, config)).trim()
      } finally {
        clearTimeout(watchdog)
        Bun.spawn(["rm", "-f", file, file.replace(/\.wav$/, ".txt")], { stdout: "ignore", stderr: "ignore" })
      }
    },
  }
}

export async function recordAndTranscribe(config?: { kv?: MarksSTTConfigSource }) {
  sttProvider(config)
  const seconds = Math.max(1, Number(valueFrom(config, "markscode_stt_record_seconds", "MARKSCODE_STT_RECORD_SECONDS", 12)) || 12)
  const language = String(valueFrom(config, "markscode_stt_language", "MARKSCODE_STT_LANGUAGE", "pt"))
  const file = "/tmp/markscode-stt-" + Date.now() + ".wav"
  try {
    await recordAudio(file, seconds, config)
    const text = await transcribeAudio(file, language, config)
    return text.trim()
  } finally {
    Bun.spawn(["rm", "-f", file, file.replace(/\.wav$/, ".txt")], { stdout: "ignore", stderr: "ignore" })
  }
}

export * as MarksSTT from "./marks"
