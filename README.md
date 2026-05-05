# GitHub Collector

> A local-first tool that turns any GitHub URL into an AI-generated evaluation report in 30 seconds.

Paste a link, and Gemini produces a structured analysis — overview, installation, usage examples, a six-dimension rating card (out of 60), and an actionable recommendation — saved to a local SQLite database for later reference.

Built to solve the **"friend recommends a repo → I star it → I never look at it again"** problem: every saved repo carries its own reasoning, and re-submitting the same URL returns the cached result without burning API quota.

## Features

- **Paste & evaluate** — submit a GitHub URL, get a full report rendered as a clean web page
- **Six-dimension rating card** (1–10 each, total out of 60): practicality, learning value, ease of use, maintenance, reliability, relevance
- **Tiered recommendation** — auto-mapped from total score (e.g. 50+ = "強烈推薦", <20 = "不推薦")
- **Local SQLite cache** — same URL twice = instant cached result, zero extra API cost
- **History view** — browse every repo you've ever evaluated
- **No build step** — Bun + Tailwind CDN means edit files, restart, done

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0
- A free [Google AI Studio](https://aistudio.google.com/apikey) API key (Gemini 2.5 Flash free tier is generous enough for personal use)

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Configure your API key
cp .env.example .env
# Edit .env and replace the placeholder with your actual key

# 3. Run
bun run dev          # hot reload
# or
bun run start        # plain run
```

Open <http://localhost:3000> and paste a GitHub URL.

## How It Works

```
User pastes URL
      │
      ▼
┌─────────────────────┐
│  Parse owner/repo   │
│  Normalize URL      │
└─────────────────────┘
      │
      ▼
┌─────────────────────┐    cache hit
│  Lookup in SQLite   │ ─────────────► return cached report
└─────────────────────┘
      │ cache miss
      ▼
┌─────────────────────┐
│  Fetch README via   │
│  r.jina.ai          │
└─────────────────────┘
      │
      ▼
┌─────────────────────┐
│  Gemini 2.5 Flash   │
│  (responseSchema    │
│  → structured JSON) │
└─────────────────────┘
      │
      ▼
┌─────────────────────┐
│  Save to SQLite     │
│  Redirect to /result │
└─────────────────────┘
```

## Routes

| Method | Path           | Description                                       |
| ------ | -------------- | ------------------------------------------------- |
| GET    | `/`            | Home page with the URL input form & recent list  |
| POST   | `/evaluate`    | Trigger evaluation, redirects to result page      |
| GET    | `/history`     | Table of every evaluation, sorted by recency      |
| GET    | `/result/:id`  | Full report for a single evaluation               |

## Tech Stack

| Layer       | Choice                            | Why                                       |
| ----------- | --------------------------------- | ----------------------------------------- |
| Runtime     | Bun                               | Native TS, built-in SQLite, fast startup  |
| Server      | `Bun.serve()`                     | No framework needed for 4 routes          |
| Database    | `bun:sqlite`                      | Zero-config local persistence             |
| LLM         | Gemini 2.5 Flash (AI Studio API)  | Free tier, native structured-JSON output  |
| README fetch| `r.jina.ai` reader proxy          | Cleaner text than scraping GitHub         |
| UI          | Server-side template literals     | No client framework, no build step        |
| Styling     | Tailwind CSS via CDN              | Custom Morandi palette via inline config  |
| Markdown    | `marked.js` via CDN               | Client-side rendering for code blocks     |

## Project Structure

```
.
├── ai.ts            # Gemini API call + JSON schema + validation
├── db.ts            # SQLite schema + CRUD helpers + score → recommendation
├── github.ts        # URL parser + README fetcher (r.jina.ai)
├── index.ts         # Bun.serve() route dispatcher
├── templates.ts     # All HTML templates + Morandi palette config
├── package.json
├── .env.example
├── .gitignore
└── evaluations.db   # Auto-created on first run
```

## Customization

| Want to change…           | Where                                                   |
| ------------------------- | ------------------------------------------------------- |
| Color palette             | `templates.ts` → `tailwind.config` block in `layout()`  |
| Gemini model              | `ai.ts` → `MODEL` constant                              |
| Scoring rubric / prompt   | `ai.ts` → `SYSTEM_PROMPT`                               |
| Recommendation thresholds | `db.ts` → `getRecommendLevel()`                         |
| Port                      | `.env` → `PORT=...` (defaults to 3000)                  |

## Notes & Limitations

- **Single-user, local-only** — no auth, no multi-tenancy, no deployment story
- **GitHub only** — GitLab/Bitbucket URLs are rejected
- **Public repos only** — `r.jina.ai` cannot read private GitHub repos
- **Free-tier privacy** — when using AI Studio's free tier, request content may be used by Google for model improvement; switch to a paid tier if that matters

## License

MIT
