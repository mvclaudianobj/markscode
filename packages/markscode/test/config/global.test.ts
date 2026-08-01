import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { ConfigGlobal } from "@/config/global"
import { tmpdir } from "../fixture/fixture"

test("creates markscode global config with default plugins", async () => {
  await using tmp = await tmpdir()
  await ConfigGlobal.ensureDefaultPlugins({ XDG_CONFIG_HOME: tmp.path })

  const file = path.join(tmp.path, "markscode", "markscode.json")
  const data = JSON.parse(await fs.readFile(file, "utf8"))
  expect(data.plugin).toEqual([...ConfigGlobal.DEFAULT_MARKSCODE_PLUGINS])
})

test("default plugins do not include native rtk or brain packages", () => {
  expect(ConfigGlobal.DEFAULT_MARKSCODE_PLUGINS).not.toContain("openrtk@latest")
  expect(ConfigGlobal.DEFAULT_MARKSCODE_PLUGINS).not.toContain("opencode-brain@latest")
})

test("preserves existing keys and appends missing default plugins", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "markscode", "markscode.json")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ model: "test/model", plugin: ["custom-plugin@1.0.0"] }, null, 2))

  await ConfigGlobal.ensureDefaultPlugins({ XDG_CONFIG_HOME: tmp.path })

  const data = JSON.parse(await fs.readFile(file, "utf8"))
  expect(data.model).toBe("test/model")
  expect(data.plugin).toEqual(["custom-plugin@1.0.0", ...ConfigGlobal.DEFAULT_MARKSCODE_PLUGINS])
})

test("does not duplicate existing plugin packages", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "markscode", "markscode.json")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        plugin: [
          "@tarquinen/opencode-dcp@1.0.0",
          [ConfigGlobal.DEFAULT_MARKSCODE_PLUGINS[1], { enabled: true }],
          "opencode-supermemory@latest",
          "openrtk@0.1.0",
          "opencode-brain@latest",
        ],
      },
      null,
      2,
    ),
  )

  await ConfigGlobal.ensureDefaultPlugins({ XDG_CONFIG_HOME: tmp.path })

  const data = JSON.parse(await fs.readFile(file, "utf8"))
  expect(data.plugin).toHaveLength(6)
  expect(data.plugin[0]).toBe("@tarquinen/opencode-dcp@1.0.0")
})

test("keeps canonical markscode notifier and removes external notifier duplicates", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "markscode", "markscode.json")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify({ plugin: ["opencode-notifier@latest", ConfigGlobal.DEFAULT_MARKSCODE_PLUGINS[1]] }, null, 2))

  await ConfigGlobal.ensureDefaultPlugins({ XDG_CONFIG_HOME: tmp.path })

  const data = JSON.parse(await fs.readFile(file, "utf8"))
  expect(data.plugin).not.toContain("opencode-notifier@latest")
  expect(data.plugin.filter((item: string) => item === ConfigGlobal.DEFAULT_MARKSCODE_PLUGINS[1])).toHaveLength(1)
  expect(data.plugin).toContain(ConfigGlobal.DEFAULT_MARKSCODE_PLUGINS[2])
})

test("skips invalid json without overwriting", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "markscode", "markscode.json")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, "{")

  await ConfigGlobal.ensureDefaultPlugins({ XDG_CONFIG_HOME: tmp.path })

  expect(await fs.readFile(file, "utf8")).toBe("{")
})

test("skips bootstrap in pure mode", async () => {
  await using tmp = await tmpdir()
  await ConfigGlobal.ensureDefaultPlugins({ XDG_CONFIG_HOME: tmp.path, OPENCODE_PURE: "1" })

  await expect(fs.stat(path.join(tmp.path, "markscode", "markscode.json"))).rejects.toThrow()
})
