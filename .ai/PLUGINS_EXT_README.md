# MarksCode external editor plugins

This folder contains lightweight, skeleton-but-functional external editor plugins for MarksCode.

- `vscode/markscode`: Visual Studio Code extension.
- `sublime/markscode`: Sublime Text plugin.
- `shared`: shared notes and conventions used by both plugins.

These plugins intentionally use the existing `markscode` CLI/local server instead of implementing their own transport, credential storage, or Markspanel client.

## Authentication model

The plugins do **not** collect, persist, or inspect Markspanel credentials.

Authentication is delegated to the installed MarksCode CLI:

```sh
markscode markspanel-login https://marks.ia.br
```

Any token storage, browser handoff, or credential handling remains owned by the CLI/local server. The editor plugins only launch commands or display command output.

## Security model

- No Markspanel credentials are stored in editor settings.
- The Markspanel URL is restricted to `http://` or `https://`.
- Commands that support arguments invoke processes with argument arrays where possible.
- VS Code terminal commands quote shell arguments before sending text to the integrated terminal.
- Optional database path settings are passed only as `MARKSCODE_DB` and `OPENCODE_DB` environment variables to spawned processes.

## Prerequisites

Install and verify the MarksCode CLI first:

```sh
markscode --help
```

If `markscode` is not on `PATH`, configure the plugin-specific binary path setting.

## Development usage

### VS Code

Open `plugins_ext/vscode/markscode` in VS Code and run the extension host from there.

Useful commands:

- `MarksCode: Open` runs `markscode` in the workspace folder.
- `MarksCode: Markspanel Login` runs `markscode markspanel-login <url>`.
- `MarksCode: Show Models` runs `markscode models --verbose` and displays output.
- `MarksCode: Insert File Reference` inserts `@relative/path#Lx-Ly` for the active editor selection or cursor.

Settings:

- `marksCode.binPath`: CLI binary/path, default `markscode`.
- `marksCode.markspanelUrl`: login URL, default `https://marks.ia.br`.
- `marksCode.dbPath`: optional MarksCode/OpenCode DB path passed through environment variables.

### Sublime Text

Copy or symlink `plugins_ext/sublime/markscode` into your Sublime `Packages` directory, then use the command palette or menu.

Settings are read from `MarksCode.sublime-settings`:

- `markscode_bin`: CLI binary/path, default `markscode`.
- `markspanel_url`: login URL, default `https://marks.ia.br`.
- `db_path`: optional MarksCode/OpenCode DB path passed through environment variables.

## Repository scope

This integration is intentionally kept under `plugins_ext/**` so it can evolve independently from the core MarksCode application and internal SDKs.
