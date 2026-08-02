import { afterEach, describe, expect, test } from "bun:test"
import { join } from "path"
import { tmpdir } from "./fixture/fixture"
import { clearMarksAgentConfigSourceCache } from "../src/marks-agent-config-source"

const previousPath = process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH
const previousTokenRef = process.env.MARKSCODE_TELEGRAM_TEST_TOKEN
const previousToken = process.env.MARKSCODE_TELEGRAM_BOT_TOKEN
const previousAllowedUsers = process.env.MARKSCODE_TELEGRAM_ALLOWED_USER_IDS
const previousChatID = process.env.MARKSCODE_TELEGRAM_CHAT_ID
const previousFetch = globalThis.fetch

afterEach(() => {
  process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = previousPath
  process.env.MARKSCODE_TELEGRAM_TEST_TOKEN = previousTokenRef
  process.env.MARKSCODE_TELEGRAM_BOT_TOKEN = previousToken
  process.env.MARKSCODE_TELEGRAM_ALLOWED_USER_IDS = previousAllowedUsers
  process.env.MARKSCODE_TELEGRAM_CHAT_ID = previousChatID
  globalThis.fetch = previousFetch
  clearMarksAgentConfigSourceCache()
})

describe("markscode-telegram-notifier", () => {
  test("reads Telegram settings from marks agent config source before env fallback", async () => {
    await using tmp = await tmpdir()
    process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH = join(tmp.path, "modules.json")
    process.env.MARKSCODE_TELEGRAM_TEST_TOKEN = "test-token"
    process.env.MARKSCODE_TELEGRAM_BOT_TOKEN = ""
    process.env.MARKSCODE_TELEGRAM_ALLOWED_USER_IDS = ""
    process.env.MARKSCODE_TELEGRAM_CHAT_ID = ""
    await Bun.write(
      process.env.MARKSCODE_AGENT_CONFIG_SOURCE_PATH,
      JSON.stringify({
        modules: {
          markscode: {
            configurator: {
              env: {
                MARKSCODE_TELEGRAM_ALLOWED_USER_IDS: "123",
                MARKSCODE_TELEGRAM_CHAT_ID: "456",
              },
              secret_refs: {
                MARKSCODE_TELEGRAM_BOT_TOKEN: { env_ref: "MARKSCODE_TELEGRAM_TEST_TOKEN" },
              },
            },
          },
        },
      }),
    )

    const requests = new Array<{ url: string; body: unknown }>()
    globalThis.fetch = ((url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) })
      return Promise.resolve(new Response("{}"))
    }) as typeof fetch

    const plugin = (await import("../vendor/markscode-telegram-notifier/dist/index.js")).default
    const notifier = await plugin()
    expect(notifier.event).toBeDefined()
    await notifier.event?.({ event: "complete", properties: { userID: "123", title: "Done", message: "OK" } })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.body).toMatchObject({ chat_id: "456", text: "Done\nOK" })
  })
})
