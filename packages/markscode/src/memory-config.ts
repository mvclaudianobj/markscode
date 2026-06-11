const DEFAULT_MEMORIES_URL = "http://api.marks.ia.br:8689"
const DEFAULT_MEMORIES_USER_ID = "marks-local"

const firstNonEmpty = (...values: Array<string | undefined>) => values.find((value) => value?.trim())?.trim() || ""

export function resolveMemoryConfig() {
  const apiKey = firstNonEmpty(process.env.MARKSCODE_MEMORIES_API_KEY, process.env.MEMORIES_API_KEY)

  return {
    memories: {
      url: firstNonEmpty(process.env.MARKSCODE_MEMORIES_URL, process.env.MEMORIES_URL) || DEFAULT_MEMORIES_URL,
      api_key: apiKey,
      api_key_source: apiKey
        ? process.env.MARKSCODE_MEMORIES_API_KEY?.trim()
          ? "MARKSCODE_MEMORIES_API_KEY"
          : "MEMORIES_API_KEY"
        : "none",
    },
    user_id: firstNonEmpty(process.env.MARKSCODE_MEMORIES_USER_ID, process.env.MEMORIES_USER_ID) || DEFAULT_MEMORIES_USER_ID,
  }
}

export function hasMemoriesAPIKey() {
  return Boolean(resolveMemoryConfig().memories.api_key)
}
