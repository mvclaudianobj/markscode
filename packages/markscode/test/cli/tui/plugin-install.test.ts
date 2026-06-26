import { expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../../fixture/fixture"
import { createTuiPluginApi } from "../../fixture/tui-plugin"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { TuiConfig } from "../../../src/cli/cmd/tui/config/tui"
import { createPlugTask, markscodeGlobalConfigDir, type PlugDeps } from "../../../src/cli/cmd/plug"
import { patchPluginConfig } from "../../../src/plugin/install"

const { TuiPluginRuntime } = await import("../../../src/cli/cmd/tui/plugin/runtime")

test("installs plugin without loading it", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const file = path.join(dir, "install-plugin.ts")
      const spec = pathToFileURL(file).href
      const marker = path.join(dir, "install.txt")

      await Bun.write(
        path.join(dir, "package.json"),
        JSON.stringify(
          {
            name: "demo-install-plugin",
            type: "module",
            exports: {
              "./tui": {
                import: "./install-plugin.ts",
                config: { marker },
              },
            },
          },
          null,
          2,
        ),
      )

      await Bun.write(
        file,
        `export default {
  id: "demo.install",
  tui: async (_api, options) => {
    if (!options?.marker) return
    await Bun.write(options.marker, "loaded")
  },
}
`,
      )

      return { spec, marker }
    },
  })

  process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "plugin-meta.json")
  const config = createTuiResolvedConfig({
    plugin: [],
  })
  const wait = spyOn(TuiConfig, "waitForDependencies").mockResolvedValue()
  const cwd = spyOn(process, "cwd").mockImplementation(() => tmp.path)
  const api = createTuiPluginApi({
    state: {
      path: {
        state: path.join(tmp.path, "state.json"),
        config: path.join(tmp.path, "tui.json"),
        worktree: tmp.path,
        directory: tmp.path,
      },
    },
  })

  try {
    await TuiPluginRuntime.init({ api, config })
    const out = await TuiPluginRuntime.installPlugin(tmp.extra.spec)
    expect(out).toMatchObject({
      ok: true,
      tui: true,
    })

    await expect(fs.readFile(tmp.extra.marker, "utf8")).rejects.toThrow()
    await expect(TuiPluginRuntime.addPlugin(tmp.extra.spec)).resolves.toBe(true)
    await expect(fs.readFile(tmp.extra.marker, "utf8")).resolves.toBe("loaded")
  } finally {
    await TuiPluginRuntime.dispose()
    cwd.mockRestore()
    wait.mockRestore()
    delete process.env.OPENCODE_PLUGIN_META_FILE
  }
})

test("patches server plugin config under markscode namespace", async () => {
  await using tmp = await tmpdir()
  const writes = new Map<string, string>()

  const out = await patchPluginConfig(
    {
      spec: "demo-server-plugin",
      targets: [{ kind: "server" }],
      worktree: tmp.path,
      directory: tmp.path,
      vcs: "git",
    },
    {
      readText: async (file) => writes.get(file) ?? "{}",
      write: async (file, text) => {
        writes.set(file, text)
      },
      exists: async (file) => writes.has(file),
      files: (dir, name) => [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)],
    },
  )

  const file = path.join(tmp.path, ".markscode", "markscode.json")
  expect(out).toMatchObject({
    ok: true,
    dir: path.join(tmp.path, ".markscode"),
    items: [{ kind: "server", mode: "add", file }],
  })
  expect(writes.get(file)).toContain('"demo-server-plugin"')
})

test("plug global writes under markscode config directory", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const plugin = path.join(dir, "plugin")
      await fs.mkdir(plugin, { recursive: true })
      await Bun.write(
        path.join(plugin, "package.json"),
        JSON.stringify(
          {
            name: "demo-server-plugin",
            main: "./server.js",
          },
          null,
          2,
        ),
      )
      return plugin
    },
  })
  const writes = new Map<string, string>()
  const global = markscodeGlobalConfigDir({ XDG_CONFIG_HOME: path.join(tmp.path, "xdg") })
  const dep: PlugDeps = {
    spinner: () => ({
      start() {},
      stop() {},
    }),
    log: {
      error() {},
      info() {},
      success() {},
    },
    resolve: async () => tmp.extra,
    readText: async (file) => writes.get(file) ?? "{}",
    write: async (file, text) => {
      writes.set(file, text)
    },
    exists: async (file) => writes.has(file),
    files: (dir, name) => [path.join(dir, `${name}.json`), path.join(dir, `${name}.jsonc`)],
    global,
  }

  const ok = await createPlugTask({ mod: "demo-server-plugin", global: true }, dep)({
    vcs: "git",
    worktree: tmp.path,
    directory: tmp.path,
  })

  const file = path.join(global, "markscode.json")
  expect(ok).toBe(true)
  expect(writes.get(file)).toContain('"demo-server-plugin"')
  expect(writes.has(path.join(tmp.path, ".markscode", "markscode.json"))).toBe(false)
})
