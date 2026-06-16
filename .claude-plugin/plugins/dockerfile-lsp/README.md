# dockerfile-lsp

Wires dockerfile-language-server-nodejs for the 16 Dockerfiles in MIRA.

## Install
`npm install -g dockerfile-language-server-nodejs`
Binary: `docker-langserver`

## Filename matching limitation
Claude Code's `extensionToLanguage` matches by file extension, but most Dockerfiles in MIRA are named just `Dockerfile` (no extension). This plugin currently matches `.dockerfile` suffix only. To make filename `Dockerfile` files trigger the LSP, either:
1. Rename to `<service>.Dockerfile`, or
2. File a follow-up to extend Claude Code's matcher to support full-filename patterns.

For now, this plugin covers `.dockerfile`-suffixed files. Standard `Dockerfile` (no extension) files will not trigger the LSP automatically.
