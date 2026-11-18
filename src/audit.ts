import { analyzeAccessibility } from './analyzers/accessibility.ts';
import { analyzeMobile } from './analyzers/mobile.ts';
import { analyzeNap } from './analyzers/nap.ts';
import { analyzePerformance } from './analyzers/performance.ts';
import { analyzeSeo } from './analyzers/seo.ts';
import { collect, type CollectOptions } from './collector/index.ts';
import { normalizeUrl } from './lib/url.ts';
import { AREA_WEIGHTS, scoreReport, type AreaWeights } from './scoring/score.ts';
import type { AreaResult, AuditReport, BusinessInfo, Evidence } from './types.ts';
import { TOOL_NAME, TOOL_VERSION } from './version.ts';

export interface AuditInput {
  url: string;
  business?: BusinessInfo;
}

export interface AuditOptions extends CollectOptions {
  weights?: AreaWeights;
}

/** Runs every analyzer. Pure: same evidence in, same results out. */
export function analyze(evidence: Evidence, business?: BusinessInfo): AreaResult[] {
  return [
    analyzePerformance(evidence),
    analyzeMobile(evidence),
    analyzeSeo(evidence),
    analyzeAccessibility(evidence),
    analyzeNap(evidence, business),
  ];
}

/** Scores analyzed evidence and assembles the report. Pure. */
export function buildReport(
  evidence: Evidence,
  input: {
    business?: BusinessInfo;
    weights?: AreaWeights;
    startedAt?: Date;
    durationMs?: number;
  } = {},
): AuditReport {
  const scored = scoreReport(analyze(evidence, input.business), input.weights ?? AREA_WEIGHTS);
  return {
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    url: evidence.requestedUrl,
    finalUrl: evidence.finalUrl,
    auditedAt: (input.startedAt ?? new Date()).toISOString(),
    durationMs: input.durationMs ?? 0,
    ...(input.business ? { business: input.business } : {}),
    overall: scored.overall,
    grade: scored.grade,
    areas: scored.areas,
    findings: scored.findings,
    screenshots: evidence.screenshots,
    evidence: {
      redirects: evidence.redirects,
      status: evidence.status,
      httpUpgrade: evidence.httpUpgrade,
      tls: evidence.tls,
      robots: {
        url: evidence.robots.url,
        status: evidence.robots.status,
        found: evidence.robots.found,
      },
      sitemap: {
        url: evidence.sitemap.url,
        status: evidence.sitemap.status,
        found: evidence.sitemap.found,
        ...(evidence.sitemap.urlCount !== undefined ? { urlCount: evidence.sitemap.urlCount } : {}),
      },
      crawl: evidence.crawl,
      lighthouse: evidence.lighthouse,
      axe: evidence.axe,
      layouts: evidence.layouts,
    },
    warnings: evidence.errors,
  };
}

/** Collects, analyzes and scores one site. */
export async function audit(input: AuditInput, options: AuditOptions = {}): Promise<AuditReport> {
  const startedAt = new Date();
  const evidence = await collect(normalizeUrl(input.url), options);
  return buildReport(evidence, {
    ...(input.business ? { business: input.business } : {}),
    ...(options.weights ? { weights: options.weights } : {}),
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
  });
}
