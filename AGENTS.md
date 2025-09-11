# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/` (TypeScript, Node ESM). Key areas:
  - `src/modules/` → feature modules (`scrapers/`, `enrichers/`, `archivers/`).
  - `src/utils/` → shared utilities (`config.ts`, `logger.ts`).
  - `src/types/` → shared interfaces (e.g., `IScraper`, `ScrapedSong`).
- Build output: `dist/` (compiled JS).
- Configuration: `config/config.yaml` (runtime settings; see Security section).

## Build, Test, and Development Commands
- `npm run dev` — Run with ts-node + nodemon (auto-reload on changes).
- `npm run build` — Compile TypeScript to `dist/` via `tsc`.
- `npm start` — Run compiled entrypoint `dist/index.js`.

Example: `npm run build && npm start` to run the latest compiled code.

## Coding Style & Naming Conventions
- Language: TypeScript, strict mode, NodeNext ESM.
- Imports: include `.js` in TS import paths (NodeNext requirement), e.g., `import { Logger } from './utils/logger.js'`.
- Indentation: 2 spaces; prefer named exports; avoid default exports.
- Keep functions small and focused; avoid tangential refactors.
- Logging: use `Logger` for info/warn/error/debug.

## Testing Guidelines
- No formal test runner is configured yet. Prefer manual/local verification:
  - Temporary entrypoint in `src/index.ts` can exercise modules.
  - For scrapers, log counts and sample rows to validate parsing.
- If adding tests, propose tooling (e.g., Vitest/Jest) in a separate PR first.

## Commit & Pull Request Guidelines
- Commits: concise, imperative subject line; group related changes.
- Recommended prefixes: feat, fix, refactor, docs, chore, build.
- PRs: include purpose, scoped change list, screenshots/log excerpts when relevant, and any config or migration notes.

## Security & Configuration Tips
- Do not commit real secrets. Prefer environment files and point `CONFIG_PATH` to a local YAML.
- `config/config.yaml` fields:
  - `wwoz.playlistUrl`
  - `chromePath` (e.g., `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`)
- Scraper uses Playwright. If bundled browsers aren’t installed, set `chromePath` or run `npx playwright install chromium`.
