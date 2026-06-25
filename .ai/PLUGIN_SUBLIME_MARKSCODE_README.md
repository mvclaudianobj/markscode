# MarksCode for Sublime Text

Lightweight Sublime Text integration for the local MarksCode CLI.

## Features

- `MarksCode: Open` runs `markscode` in the active window folder.
- `MarksCode: Markspanel Login` runs `markscode markspanel-login <url>`.
- `MarksCode: Show Models` runs `markscode models --verbose` and displays output in an output panel.
- `MarksCode: Insert File Reference` inserts `@relative/path#Lx-Ly` for the active view cursor or selection.

## Installation for development

Copy or symlink this folder to your Sublime Text `Packages` directory as `MarksCode`.

## Settings

Create or edit `Packages/User/MarksCode.sublime-settings`:

```json
{
  "markscode_bin": "markscode",
  "markspanel_url": "https://marks.ia.br",
  "db_path": ""
}
```

- `markscode_bin`: MarksCode CLI binary name or absolute path.
- `markspanel_url`: Markspanel login URL. Only `http` and `https` are accepted.
- `db_path`: optional DB path passed as `MARKSCODE_DB` and `OPENCODE_DB`.

## Authentication and security

This plugin does not collect or store Markspanel credentials. Authentication is delegated to the MarksCode CLI/local server.

Process execution uses argument arrays through Sublime `exec` or Python `subprocess` instead of building shell command strings.
