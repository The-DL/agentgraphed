# Changelog

All notable changes to this project will be documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] — 2026-06-06

### Fixed
- Re-publish to attach README to the npm registry metadata (0.1.0 was published with an empty README field, causing npmjs.com to show "no README").

### Changed
- Timeline now shows multi-day sessions on every day they touched, tagged `STARTED · SPANS Nd` / `CONTINUED` / `CLOSED`. Day totals attribute tokens to the day a session closed to avoid double-counting.
- Trimmed ~13 MB of dead weight from the npm tarball (pruned TypeScript and Next's AMP validator from the standalone bundle).
- Removed the multi-machine `onboard`/`offboard` hook flow and the `/api/ingest` remote endpoint; AgentGraphed is single-user, local-only.

## [0.1.0] — 2026-06-06

Initial public release.

### Added
- Dashboard, Timeline, Projects, Sessions, Analytics, Settings pages
- Automatic ingest of Claude Code (`~/.claude/projects`) and Codex CLI (`~/.codex/sessions`) sessions
- Project resolution via git repo root with cwd-basename fallback
- LiteLLM-powered pricing for 2700+ models, refreshed at build time
- Optional LLM-powered multi-label session classification and titles (Anthropic or OpenAI, BYO key)
- Resume button — copies `cd <cwd> && claude --resume <id>`
- Copy-context button — generates a structured primer for a fresh chat
- 7d / 30d / 90d / all-time range picker on Dashboard + Analytics
- Auto-suggested log/linear chart scale when one day dwarfs the rest
- Dark "deep-tech" UI with sticky sidebar + header
