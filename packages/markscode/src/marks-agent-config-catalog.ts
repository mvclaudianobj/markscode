export type MarksAgentConfigGroup = "MEMORIES" | "TELEGRAM" | "TTS" | "STT" | "GRAPHFY" | "MAP" | "QDRANT" | "MEMVID" | "DATABASE" | "VISION" | "BRAIN_OBSIDIAN" | "UPDATER_INSTALL" | "NOTIFIER"

export type MarksAgentConfigType = "string" | "number" | "boolean" | "secret_ref" | "list" | "path" | "url" | "pattern"

export type MarksAgentConfigScope = "runtime" | "session" | "project" | "user" | "system" | "install"

export type MarksAgentConfigCatalogEntry = {
  key: string
  group: MarksAgentConfigGroup
  type: MarksAgentConfigType
  sensitive: boolean
  scope: MarksAgentConfigScope
  description: string
}

const entry = (key: string, group: MarksAgentConfigGroup, type: MarksAgentConfigType, sensitive: boolean, scope: MarksAgentConfigScope, description: string) => ({ key, group, type, sensitive, scope, description })

export const MARKS_AGENT_CONFIG_CATALOG = [
  entry("MARKSCODE_HYBRID_MEMORY", "MEMORIES", "boolean", false, "runtime", "Ativa o prompt de memória híbrida no MarksCode."),
  entry("MARKSCODE_RAG", "MEMORIES", "boolean", false, "runtime", "Ativa integração RAG para recuperação contextual."),
  entry("MARKSCODE_MEMORY_PROVIDER", "MEMORIES", "string", false, "runtime", "Seleciona provider de memória: cloud, local ou hybrid."),
  entry("MARKSCODE_MEMORY_RECALL_LIMIT", "MEMORIES", "number", false, "runtime", "Limite padrão de memórias recuperadas."),
  entry("MARKSCODE_MEMORY_MAX_CHARS", "MEMORIES", "number", false, "runtime", "Tamanho máximo de texto recuperado das memórias."),
  entry("MARKSCODE_MEMORIES_URL", "MEMORIES", "url", false, "runtime", "URL base da Memories API."),
  entry("MARKSCODE_MEMORIES_API_KEY", "MEMORIES", "secret_ref", true, "runtime", "Referência secreta para autenticação na Memories API."),
  entry("MARKSCODE_MEMORIES_USER_ID", "MEMORIES", "string", false, "user", "Identificador padrão do usuário nas memórias."),
  entry("MARKSCODE_MEMORIES_API_TIMEOUT_MS", "MEMORIES", "number", false, "runtime", "Timeout padrão das chamadas à Memories API em milissegundos."),
  entry("MARKSCODE_ADMIN_MEMORY_FALLBACK", "MEMORIES", "boolean", false, "runtime", "Permite fallback administrativo de memória quando o recall principal for fraco."),
  entry("MARKSCODE_RECENT_TOPICS_TIMEOUT_MS", "MEMORIES", "number", false, "runtime", "Timeout da listagem de tópicos recentes de memória."),
  entry("MARKSCODE_TELEGRAM_BOT_TOKEN", "TELEGRAM", "secret_ref", true, "runtime", "Referência secreta do token do bot Telegram."),
  entry("MARKSCODE_TELEGRAM_ALLOWED_USER_IDS", "TELEGRAM", "list", false, "runtime", "Lista de usuários Telegram autorizados."),
  entry("MARKSCODE_TELEGRAM_CHAT_ID", "TELEGRAM", "string", false, "runtime", "Chat padrão para notificações Telegram."),
  entry("MARKSCODE_TTS_PROVIDER", "TTS", "string", false, "runtime", "Provider de síntese de voz."),
  entry("MARKSCODE_TTS_VOICE", "TTS", "string", false, "runtime", "Voz padrão do TTS."),
  entry("MARKSCODE_TTS_VOLUME", "TTS", "number", false, "runtime", "Volume de reprodução do TTS."),
  entry("MARKSCODE_TTS_PLAYER", "TTS", "string", false, "runtime", "Player local usado para áudio TTS."),
  entry("MARKSCODE_TTS_MAX_CHARS", "TTS", "number", false, "runtime", "Tamanho máximo de texto enviado ao TTS."),
  entry("MARKSCODE_TTS_G4F_SPACE_TOKEN", "TTS", "secret_ref", true, "runtime", "Referência secreta para token G4F Space do TTS."),
  entry("MARKS_G4F_SPACE_TOKEN", "TTS", "secret_ref", true, "runtime", "Referência secreta legada para token G4F Space."),
  entry("MARKSCODE_TTS_DESKTOP_USER", "TTS", "string", false, "runtime", "Usuário desktop usado para reprodução de áudio quando executado como root."),
  entry("MARKSCODE_TTS_DESKTOP_UID", "TTS", "number", false, "runtime", "UID desktop usado para áudio PulseAudio/PipeWire."),
  entry("MARKSCODE_TTS_STREAMING", "TTS", "boolean", false, "runtime", "Ativa streaming de texto para TTS."),
  entry("MARKSCODE_TTS_STREAM_INTERVAL_MS", "TTS", "number", false, "runtime", "Intervalo de envio do TTS em streaming."),
  entry("MARKS_G4F_SPACE_URL", "TTS", "url", false, "runtime", "URL base proxy G4F Space."),
  entry("MARKS_G4F_SPACE_V1_AUDIO", "TTS", "boolean", false, "runtime", "Controla uso do endpoint de áudio v1 do G4F Space."),
  entry("MARKSCODE_STT_PROVIDER", "STT", "string", false, "runtime", "Provider de transcrição de voz."),
  entry("MARKSCODE_STT_LANGUAGE", "STT", "string", false, "runtime", "Idioma padrão da transcrição."),
  entry("MARKSCODE_STT_MODEL", "STT", "path", false, "runtime", "Caminho do modelo Whisper local."),
  entry("MARKSCODE_STT_WHISPER_COMMAND", "STT", "string", false, "runtime", "Comando local whisper-cli/whisper."),
  entry("MARKSCODE_STT_WHISPER_SERVER_COMMAND", "STT", "string", false, "runtime", "Comando local whisper-server."),
  entry("MARKSCODE_STT_SERVER_URL", "STT", "url", false, "runtime", "URL do servidor STT compatível com whisper.cpp."),
  entry("MARKSCODE_STT_RECORDER", "STT", "string", false, "runtime", "Gravador local de áudio."),
  entry("MARKSCODE_STT_RECORD_SECONDS", "STT", "number", false, "runtime", "Duração padrão de gravação STT."),
  entry("MARKSCODE_STT_CAPTURE_MAX_SECONDS", "STT", "number", false, "runtime", "Tempo máximo de captura contínua STT."),
  entry("MARKSCODE_STT_DESKTOP_USER", "STT", "string", false, "runtime", "Usuário desktop usado para captura de áudio quando executado como root."),
  entry("MARKSCODE_STT_DESKTOP_UID", "STT", "number", false, "runtime", "UID desktop usado para captura PulseAudio/PipeWire."),
  entry("MARKSCODE_STT_PYTHON", "STT", "path", false, "runtime", "Interpretador Python usado pelo faster-whisper."),
  entry("MARKSCODE_STT_FASTER_*", "STT", "pattern", false, "runtime", "Prefixo de configurações faster-whisper como modelo, device e compute type."),
  entry("MARKSCODE_STT_FASTER_MODEL", "STT", "string", false, "runtime", "Modelo faster-whisper."),
  entry("MARKSCODE_STT_FASTER_DEVICE", "STT", "string", false, "runtime", "Device faster-whisper."),
  entry("MARKSCODE_STT_FASTER_COMPUTE_TYPE", "STT", "string", false, "runtime", "Compute type faster-whisper."),
  entry("MARKSCODE_GRAPHFY_ENABLED", "GRAPHFY", "boolean", false, "runtime", "Ativa ou desativa Graphfy."),
  entry("MARKSCODE_GRAPHFY_OPENAI_BASE_URL", "GRAPHFY", "url", false, "runtime", "Base URL OpenAI compatível usada pelo Graphfy."),
  entry("MARKSCODE_GRAPHFY_MODEL", "GRAPHFY", "string", false, "runtime", "Modelo usado pelo Graphfy."),
  entry("MARKSCODE_GRAPHFY_OPENAI_API_KEY", "GRAPHFY", "secret_ref", true, "runtime", "Referência secreta de API key OpenAI compatível para Graphfy."),
  entry("MARKSCODE_GRAPHFY_CLI", "GRAPHFY", "path", false, "runtime", "Caminho do CLI Graphfy/Graphify."),
  entry("MARKSCODE_GRAPHFY_GRAPH", "GRAPHFY", "path", false, "project", "Caminho do graph.json gerado pelo Graphfy."),
  entry("MARKSCODE_API_KEY", "GRAPHFY", "secret_ref", true, "runtime", "Referência secreta de API key MarksCode."),
  entry("MARKS_API_KEY", "GRAPHFY", "secret_ref", true, "runtime", "Referência secreta de API key Marks."),
  entry("OPENAI_API_KEY", "GRAPHFY", "secret_ref", true, "runtime", "Referência secreta de API key OpenAI."),
  entry("MARKSCODE_MAP_API_URL", "MAP", "url", false, "runtime", "URL base da API MAP."),
  entry("MAP_API_BASE_URL", "MAP", "url", false, "runtime", "URL base alternativa da API MAP."),
  entry("MARKSCODE_MAP_HOST", "MAP", "string", false, "runtime", "Host lógico usado em eventos e planejamento MAP."),
  entry("MARKSCODE_MAP_ACTOR", "MAP", "string", false, "user", "Ator padrão usado em tarefas e eventos MAP."),
  entry("MARKSCODE_QDRANT_ENABLED", "QDRANT", "boolean", false, "runtime", "Ativa integração Qdrant."),
  entry("MARKSCODE_QDRANT_HOST", "QDRANT", "string", false, "runtime", "Host do Qdrant."),
  entry("MARKSCODE_QDRANT_PORT", "QDRANT", "number", false, "runtime", "Porta do Qdrant."),
  entry("MARKSCODE_QDRANT_API_KEY", "QDRANT", "secret_ref", true, "runtime", "Referência secreta da API key Qdrant."),
  entry("MARKSCODE_QDRANT_COLLECTION", "QDRANT", "string", false, "runtime", "Coleção Qdrant usada pela memória híbrida."),
  entry("MARKSCODE_MEMVID_CAPSULE", "MEMVID", "path", false, "runtime", "Caminho da cápsula Memvid."),
  entry("MARKSCODE_MEMVID_AUTO_INIT", "MEMVID", "boolean", false, "runtime", "Inicializa cápsula Memvid automaticamente."),
  entry("MARKSCODE_MEMVID_CLI", "MEMVID", "path", false, "runtime", "Caminho do CLI markscode-memvid."),
  entry("MARKSCODE_MEMVID_SOURCE_DIR", "MEMVID", "path", false, "project", "Diretório fonte para preparar ou indexar Memvid."),
  entry("MARKSCODE_REQUIRE_MEMVID", "MEMVID", "boolean", false, "runtime", "Exige Memvid disponível para operações locais."),
  entry("MARKSCODE_PREPARE_MEMVID_VENDOR", "MEMVID", "boolean", false, "install", "Permite preparar vendor do Memvid no instalador."),
  entry("MEMVID_DIR", "MEMVID", "path", false, "system", "Diretório local do projeto/sidecar Memvid."),
  entry("MARKSCODE_DB", "DATABASE", "path", false, "runtime", "Banco SQLite principal do MarksCode."),
  entry("MARKSCODE_DB_SELECTOR", "DATABASE", "string", false, "runtime", "Seletor de banco do MarksCode."),
  entry("MARKSCODE_DB_SELECT", "DATABASE", "string", false, "runtime", "Seleção alternativa de banco do MarksCode."),
  entry("MARKSCODE_OMNIPARSER_BIN", "VISION", "path", false, "runtime", "Binário sidecar OmniParser usado pela ferramenta vision."),
  entry("MARKSCODE_OMNIPARSER_ARGS", "VISION", "string", false, "runtime", "Template de argumentos para o OmniParser."),
  entry("MARKS_ECOSYSTEM_DIR", "VISION", "path", false, "system", "Diretório ecosystem usado para localizar sidecars."),
  entry("MARKSCODE_OBSIDIAN_PATH", "BRAIN_OBSIDIAN", "path", false, "user", "Caminho do vault Obsidian para ingestão Brain."),
  entry("MARKSCODE_BRAIN_TOKEN", "BRAIN_OBSIDIAN", "secret_ref", true, "runtime", "Referência secreta do token Brain."),
  entry("BRAIN_TOKEN", "BRAIN_OBSIDIAN", "secret_ref", true, "runtime", "Referência secreta legada do token Brain."),
  entry("MARKSCODE_INSTALL_URL", "UPDATER_INSTALL", "url", false, "install", "URL principal de instalação MarksCode."),
  entry("MARKSCODE_INSTALL_FALLBACK_URL", "UPDATER_INSTALL", "url", false, "install", "URL fallback de instalação MarksCode."),
  entry("MARKSCODE_WINDOWS_INSTALL_URL", "UPDATER_INSTALL", "url", false, "install", "URL de instalação Windows."),
  entry("MARKSCODE_WINDOWS_FALLBACK_URL", "UPDATER_INSTALL", "url", false, "install", "URL fallback de instalação Windows."),
  entry("MARKSCODE_LATEST_URL", "UPDATER_INSTALL", "url", false, "install", "URL de metadados da última versão."),
  entry("MARKSCODE_GITHUB_REPO", "UPDATER_INSTALL", "string", false, "install", "Repositório GitHub usado por updater/install."),
  entry("MARKSCODE_GITHUB_TOKEN", "UPDATER_INSTALL", "secret_ref", true, "install", "Referência secreta de token GitHub MarksCode."),
  entry("GITHUB_TOKEN", "UPDATER_INSTALL", "secret_ref", true, "install", "Referência secreta de token GitHub."),
  entry("GH_TOKEN", "UPDATER_INSTALL", "secret_ref", true, "install", "Referência secreta de token GitHub CLI."),
  entry("MARKSCODE_NOTIFIER_CONFIG_PATH", "NOTIFIER", "path", false, "runtime", "Caminho do arquivo de configuração do notifier."),
  entry("MARKSCODE_NOTIFIER_WINDOW_ID", "NOTIFIER", "string", false, "session", "ID de janela usado pelo notifier."),
  entry("MARKSCODE_CLIENT", "NOTIFIER", "string", false, "runtime", "Cliente/origem usado por notificações e integrações."),
] as const satisfies readonly MarksAgentConfigCatalogEntry[]

export function getMarksAgentConfigCatalog() {
  return MARKS_AGENT_CONFIG_CATALOG
}

export function getMarksAgentConfigGroups() {
  return Array.from(new Set(MARKS_AGENT_CONFIG_CATALOG.map((item) => item.group)))
}

export function getMarksAgentConfigCatalogGroup(group: MarksAgentConfigGroup) {
  return MARKS_AGENT_CONFIG_CATALOG.filter((item) => item.group === group)
}
