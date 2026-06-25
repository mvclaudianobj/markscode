# MarksCode for VS Code

Lightweight VS Code integration for the local MarksCode CLI.

## Features

- `MarksCode: Open` opens/focuses an integrated terminal and runs `markscode` in the current workspace folder.
- `MarksCode: Markspanel Login` runs `markscode markspanel-login <url>` in an integrated terminal.
- `MarksCode: Show Models` runs `markscode models --verbose` with `child_process.execFile` and shows stdout/stderr in an output channel.
- `MarksCode: Insert File Reference` inserts `@relative/path#Lx-Ly` for the active editor cursor or selection.

## Settings

```json
{
  "marksCode.binPath": "markscode",
  "marksCode.markspanelUrl": "https://marks.ia.br",
  "marksCode.dbPath": ""
}
```

- `marksCode.binPath`: MarksCode CLI binary name or absolute path.
- `marksCode.markspanelUrl`: URL used by `markscode markspanel-login`. Only `http` and `https` are accepted.
- `marksCode.dbPath`: optional DB path passed as `MARKSCODE_DB` and `OPENCODE_DB`.

## Authentication and security

This extension does not store Markspanel credentials. Login is delegated to the MarksCode CLI. Any token handling is owned by the CLI/local server.

Terminal commands quote arguments before sending text. Non-terminal command execution uses `execFile` with argument arrays.

## Development

1. Open `plugins_ext/vscode/markscode` in VS Code.
2. Run `npm install` if you want local type/build tooling.
3. Press `F5` to launch the Extension Development Host.

Checks:

```sh
node --check esbuild.js
npm run check-types
node esbuild.js
```
