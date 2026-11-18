/**
 * Domain model shared by every stage of the pipeline:
 *
 *   collector  ->  Evidence      (raw, serialisable facts about one site)
 *   analyzers  ->  AreaResult[]  (pure functions of Evidence + BusinessInfo)
 *   scoring    ->  AuditReport   (scores, ranked fixes)
 *   reporters  ->  HTML / JSON / Markdown / PDF
 *
 * Nothing in here depends on a browser, so analyzers and scoring can be tested
 * with hand-written fixtures.
 */

/** What the caller knows about the business, e.g. from OpenStreetMap. */
export interface BusinessInfo {
  name?: string;
  address?: string;
  phone?: string;
  /** Free-form reference shown in the report, e.g. an OSM URL. */
  source?: string;
}

export type AreaId = 'performance' | 'accessibility' | 'mobile' | 'seo' | 'nap';

export const AREA_IDS: readonly AreaId[] = [
  'performance',
  'mobile',
  'seo',
  'accessibility',
  'nap',
] as const;

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Effort = 'quick' | 'moderate' | 'major';

/** One yes/no-ish test inside an area. `score` is 0..1, ignored when skipped. */
export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  /** Relative importance inside its area. */
  weight: number;
  score: number;
  /** One plain-English sentence explaining what was measured. */
  detail: string;
}

/** Something the owner can fix, linked to the check whose points it recovers. */
export interface Finding {
  id: string;
  area: AreaId;
  checkId: string;
  /** Portion (0..1] of the check's lost points this finding accounts for. */
  share: number;
  severity: Severity;
  effort: Effort;
  /** Headline in plain English, e.g. "Your menu is a 6 MB PDF". */
  title: string;
  /** Why it matters to a customer, no jargon. */
  explanation: string;
  /** What to do about it. */
  fix: string;
}

export interface AreaResult {
  area: AreaId;
  checks: Check[];
  findings: Finding[];
  /** Set when the area could not be measured at all (e.g. no business info). */
  skippedReason?: string;
}

export interface ScoredArea extends AreaResult {
  /** 0..100, or null when every check was skipped. */
  score: number | null;
  label: string;
}

export interface RankedFinding extends Finding {
  /** Estimated points the overall score gains if this is fixed. */
  gain: number;
}

export interface AuditReport {
  tool: { name: string; version: string };
  url: string;
  finalUrl: string;
  auditedAt: string;
  durationMs: number;
  business?: BusinessInfo;
  overall: number | null;
  grade: Grade;
  areas: ScoredArea[];
  findings: RankedFinding[];
  screenshots: Screenshot[];
  /** Summary of the evidence (without bulky HTML). */
  evidence: EvidenceSummary;
  warnings: string[];
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F' | '?';

/* ------------------------------------------------------------------ */
/* Evidence: what the collector hands to analyzers.                    */
/* ------------------------------------------------------------------ */

export interface RedirectHop {
  url: string;
  status: number;
}

export interface TlsInfo {
  /** True when the certificate chain validated against the system roots. */
  valid: boolean;
  issuer?: string;
  validTo?: string;
  daysRemaining?: number;
  error?: string;
}

export interface FetchedFile {
  url: string;
  status: number | null;
  found: boolean;
  body?: string;
}

export interface LinkCheck {
  url: string;
  status: number | null;
  /** Page the link was found on. */
  foundOn: string;
  error?: string;
}

export interface HeavyFile {
  url: string;
  bytes: number;
  contentType: string;
  foundOn: string;
}

export interface CrawlResult {
  pagesVisited: string[];
  linksChecked: number;
  broken: LinkCheck[];
  heavyFiles: HeavyFile[];
  blockedByRobots: number;
  /** True when the page/request budget ran out before the crawl finished. */
  truncated: boolean;
}

export interface LighthouseMetrics {
  /** All times in milliseconds. */
  fcp: number | null;
  lcp: number | null;
  tbt: number | null;
  cls: number | null;
  speedIndex: number | null;
  ttfb: number | null;
}

export interface LighthouseResource {
  url: string;
  bytes: number;
  resourceType: string;
}

export interface LighthouseRun {
  formFactor: 'mobile' | 'desktop';
  /** Lighthouse performance score, 0..1. */
  score: number | null;
  metrics: LighthouseMetrics;
  totalBytes: number | null;
  requestCount: number | null;
  largestResources: LighthouseResource[];
  lighthouseVersion: string;
}

export interface AxeNode {
  target: string;
  html: string;
}

export interface AxeViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  help: string;
  description: string;
  helpUrl: string;
  nodeCount: number;
  nodes: AxeNode[];
}

export interface AxeSummary {
  violations: AxeViolation[];
  passes: number;
  incomplete: number;
  axeVersion: string;
}

export interface LayoutElement {
  selector: string;
  /** Width/height in CSS px after page zoom. */
  width: number;
  height: number;
  text?: string;
}

export interface ViewportLayout {
  width: number;
  /** Layout viewport width the page actually used (980 without a viewport meta). */
  layoutWidth: number;
  /** document scroll width in layout px. */
  scrollWidth: number;
  /** Visual scale the phone applied (0.38 when a 980px page is squeezed onto 375px). */
  scale: number;
  overflowing: LayoutElement[];
  tapTargets: { total: number; small: LayoutElement[] };
  text: { totalChars: number; smallChars: number; samples: LayoutElement[] };
}

export interface Screenshot {
  width: number;
  height: number;
  mime: 'image/jpeg' | 'image/png';
  /** Base64 data, no prefix. */
  data: string;
}

export interface Evidence {
  requestedUrl: string;
  finalUrl: string;
  /** Hops followed from the requested URL, last one is the final response. */
  redirects: RedirectHop[];
  status: number | null;
  headers: Record<string, string>;
  /** True when the host is localhost / a private address (HTTPS checks are skipped). */
  isLocal: boolean;
  /** What happens when the http:// version is requested. null when not checked. */
  httpUpgrade: { finalUrl: string; upgradesToHttps: boolean } | null;
  tls: TlsInfo | null;
  /** Rendered HTML of the landing page. */
  html: string;
  /** Visible text of the landing page. */
  text: string;
  robots: FetchedFile;
  sitemap: FetchedFile & { urlCount?: number };
  crawl: CrawlResult | null;
  lighthouse: { mobile: LighthouseRun | null; desktop: LighthouseRun | null; error?: string };
  axe: AxeSummary | null;
  layouts: ViewportLayout[];
  screenshots: Screenshot[];
  errors: string[];
}

export interface EvidenceSummary {
  redirects: RedirectHop[];
  status: number | null;
  httpUpgrade: Evidence['httpUpgrade'];
  tls: TlsInfo | null;
  robots: Omit<FetchedFile, 'body'>;
  sitemap: Omit<FetchedFile, 'body'> & { urlCount?: number };
  crawl: CrawlResult | null;
  lighthouse: Evidence['lighthouse'];
  axe: AxeSummary | null;
  layouts: ViewportLayout[];
}
