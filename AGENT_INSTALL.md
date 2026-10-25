# Agent Installation Protocol (`hubseb`)

If a user asked you (an AI coding agent) to install `hubseb` from this repository:

## 1. Build and Verify
```sh
npm install
npm run typecheck
npm run build
npm test
```

## 2. Link / Install CLI Globally
If `~/.local/bin` is in the user's `PATH` (standard on Linux/Omarchy), create a symlink or run `npm link`:
```sh
chmod +x dist/bin/hubseb.js
ln -sf "$(pwd)/dist/bin/hubseb.js" ~/.local/bin/hubseb
```

## 3. Verify Installation
```sh
hubseb capabilities --json
hubseb agents --json
```
