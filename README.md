<p align="center">
  <a href="https://markscode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Markscode logo">
    </picture>
  </a>
</p>
<p align="center">The AI coding agent built for the terminal.</p>
<p align="center">
  <a href="https://markscode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/markscode-ai"><img alt="npm" src="https://img.shields.io/npm/v/markscode-ai?style=flat-square" /></a>
  <a href="https://github.com/sst/markscode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/sst/markscode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

[![Markscode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://markscode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://markscode.ai/install | bash

# Package managers
npm i -g markscode-ai@latest        # or bun/pnpm/yarn
scoop bucket add extras; scoop install extras/markscode  # Windows
choco install markscode             # Windows
brew install markscode              # macOS and Linux
paru -S markscode-bin               # Arch Linux
mise use --pin -g ubi:sst/markscode # Any OS
nix run nixpkgs#markscode           # or github:sst/markscode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if exists or can be created)
4. `$HOME/.markscode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://markscode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://markscode.ai/install | bash
```

### Agents

Markscode includes two built-in agents you can switch between,
you can switch between these using the `Tab` key.

- **build** - Default, full access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also, included is a **general** subagent for complex searches and multi-step tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://markscode.ai/docs/agents).

### Documentation

For more info on how to configure Markscode [**head over to our docs**](https://markscode.ai/docs).

### Contributing

If you're interested in contributing to Markscode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on Markscode

If you are working on a project that's related to Markscode and is using "markscode" as a part of its name; for example, "markscode-dashboard" or "markscode-mobile", please add a note to your README to clarify that it is not built by the Markscode team and is not affiliated with us in anyway.

### FAQ

#### How is this different than Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although we recommend the models we provide through [Markscode Zen](https://markscode.ai/zen); Markscode can be used with Claude, OpenAI, Google or even local models. As models evolve the gaps between them will close and pricing will drop so being provider-agnostic is important.
- Out of the box LSP support
- A focus on TUI. Markscode is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This for example can allow Markscode to run on your computer, while you can drive it remotely from a mobile app. Meaning that the TUI frontend is just one of the possible clients.

#### What's the other repo?

The other confusingly named repo has no relation to this one. You can [read the story behind it here](https://x.com/thdxr/status/1933561254481666466).

---

**Join our community** [Discord](https://discord.gg/markscode) | [X.com](https://x.com/markscode)
