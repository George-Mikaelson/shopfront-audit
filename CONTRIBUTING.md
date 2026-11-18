# Contributing

Thanks for taking the time. Bug reports, false positives and plain-English rewrites of findings
are all welcome.

## Reporting a problem

Open an issue with the command you ran, the version (`shopfront-audit --version`) and, if you can
share it, the `report.json`. If a finding is wrong for a site, say what the site really does.
Please do not paste reports about other people's businesses in public issues without their
permission.

## Setting up

```sh
git clone https://github.com/George-Mikaelson/shopfront-audit.git
cd shopfront-audit
npm ci
npx playwright install chromium
npm test
```

Node 24 is used in CI. The source is TypeScript run directly by Node (type stripping), so
`node src/cli.ts https://example.com` works without a build.

## How the code is organised

- `src/collector/` talks to the network and the browser and returns an `Evidence` object.
- `src/analyzers/` turn evidence into checks and findings. They are pure functions.
- `src/scoring/` computes area scores, the overall score and the ranking of fixes.
- `src/reporters/` render HTML, Markdown, JSON and PDF.
- `src/batch.ts` and `src/cli.ts` are the batch runner and the command line.

New checks almost always belong in an analyzer, with the raw data they need added to `Evidence`.

## Pull requests

1. Write a failing test first. Analyzer tests use HTML fixtures and the `makeEvidence()` helper in
   `test/support/evidence.ts`; they should not need a browser.
2. Keep findings in plain English. Say what the visitor experiences, then what to do. Avoid jargon
   in titles; put technical terms in the detail line if they are needed.
3. Run `npm run lint`, `npm run typecheck` and `npm test` before pushing.
4. If the report changes visually, run `npm run demo` and include the updated screenshots.
5. Add a line to `CHANGELOG.md` under "Unreleased".

By contributing you agree that your work is released under the MIT license.
