<p align="center">
  <a href="https://postra.co.uk"><img src="https://postra.co.uk/logon3obackground.webp" alt="Postra" width="140"></a>
</p>

<h1 align="center">Postra</h1>

<p align="center">
  <strong>Create a month of social media content in one afternoon.</strong><br/>
  AI writes posts, images and video for you — Postra plans, publishes and analyses across every platform.
</p>

<p align="center">
  <a href="https://github.com/Postra-app/Postra-app/actions/workflows/build.yml">
    <img src="https://github.com/Postra-app/Postra-app/actions/workflows/build.yml/badge.svg" alt="Build">
  </a>
  <a href="https://opensource.org/license/agpl-v3">
    <img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="License: AGPL-3.0">
  </a>
  <a href="https://postra.co.uk">
    <img src="https://img.shields.io/badge/web-postra.co.uk-38bdf8.svg" alt="postra.co.uk">
  </a>
  <a href="https://postra.pl">
    <img src="https://img.shields.io/badge/web-postra.pl-a78bfa.svg" alt="postra.pl">
  </a>
</p>

<p align="center">
  <a href="https://postra.co.uk"><img src="https://postra.co.uk/screens/kalendarz.png" alt="Postra calendar — a month of posts scheduled across every platform" width="720"></a>
</p>

---

## What is Postra

Postra is a social media management platform with AI built in — made for small businesses, creators and agencies that don't have all day for social media. Plan content on a drag-and-drop calendar, generate posts, graphics and video in the built-in **Studio**, publish everywhere at once and track the results.

- 🌐 Website: **[postra.co.uk](https://postra.co.uk)** (UK) · **[postra.pl](https://postra.pl)** (Poland)
- 🚀 App: **[app.postra.pl](https://app.postra.pl)** — free 7-day trial, no card required

## Features

- 📅 **Smart calendar** — plan weeks ahead with drag & drop; day, week and month views
- 📣 **Publish everywhere** — one post, every connected platform at once, delivered on time by a Temporal-backed scheduler
- ✨ **AI content** — paste a topic or a link and get platform-tailored posts, images and carousels, matched to your Brand Kit
- 🎬 **Studio** — canvas design editor with AI refine, templates, multi-format export, video trimming and auto-captions (Whisper)
- 📰 **RSS Auto Post** — connect your blog feed; every new article becomes ready-made, AI-rewritten posts for each platform
- 📊 **Analytics** — reach, engagement and growth per channel and per post
- 👥 **Teams** — organisations, roles and shared calendars for agencies and marketing teams
- 🔌 **Public API & webhooks** — automate posting and react to events from your own tools
- 🌍 **English + Polish UI**, GDPR-aware, hosted in the UK/EU

## Platforms

Facebook · Instagram · Threads · X (Twitter) · LinkedIn · YouTube · TikTok · Bluesky · Mastodon · Telegram · Discord — with LinkedIn Pages and more on the way.

## Built on Postiz

Postra is a derivative of the open-source **[Postiz](https://github.com/gitroomhq/postiz-app)** project (`gitroomhq/postiz-app`), licensed under **AGPL-3.0**. In line with the AGPL-3.0, Postra's source — including our modifications — is public in this repository. Huge thanks to the Postiz team for the foundation.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js + React |
| Backend | NestJS |
| Scheduler | Temporal |
| Data | PostgreSQL + Redis |
| AI | OpenAI (GPT, image generation, Whisper) |
| Infra | AWS (EC2, RDS, ALB, ECR, S3, CloudFront) — managed in a private infra repo |

## Monorepo

```
apps/
  frontend/      # Next.js app (UI, Studio design editor)
  backend/       # NestJS API
  orchestrator/  # Temporal workflows & activities
libraries/       # shared services (DB/Prisma, OpenAI, studio, upload, …)
```

Built with **pnpm**. See `CLAUDE.md` for repo conventions.

## Development

```bash
pnpm install
docker compose -f docker-compose.dev.yaml up -d   # Postgres, Redis, Temporal
cp .env.example .env                               # fill in required vars
pnpm run prisma-db-migrate
pnpm run dev                                        # frontend :4200, backend :3000
```

## Security

Found a vulnerability? Please report it responsibly — see [SECURITY.md](SECURITY.md).

## License

This repository's source code is available under the [AGPL-3.0 license](LICENSE). See [NOTICE](NOTICE) for attribution to the upstream Postiz project.
