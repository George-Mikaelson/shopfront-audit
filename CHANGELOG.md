# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-18

### Added

- `shopfront-audit <url>` audits one site and writes HTML, JSON, Markdown and PDF reports.
- Speed checks with Lighthouse (mobile and desktop) run through chrome-launcher.
- Phone checks at 375, 768 and 1280 px: viewport tag, sideways scrolling, tap target size,
  text size after zoom, PDF menus. Screenshots at each width.
- Local SEO checks: HTTPS and certificate, redirects, noindex, robots.txt, sitemap, title,
  description, H1, Open Graph, schema.org LocalBusiness data, broken internal links.
- Accessibility checks with axe-core, grouped by impact, with plain-English explanations.
- Name, address and phone comparison against details passed on the command line or in a CSV.
- Scores per area and overall, letter grades, and fixes ranked by the points they recover.
- Batch mode (`--csv`) with limited concurrency, retries, per-site timeout, a result cache,
  structured JSON logs, `summary.csv` and an index page.
- Reusable GitHub Action that comments the summary and uploads the report as an artifact.
- Library API (`audit`, `collect`, `analyze`, `buildReport`, reporters).
