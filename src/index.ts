export { analyze, audit, buildReport, type AuditInput, type AuditOptions } from './audit.ts';
export {
  leadsFromCsv,
  runBatch,
  type AuditFn,
  type BatchOptions,
  type BatchResult,
  type Lead,
} from './batch.ts';
export { collect, type CollectOptions } from './collector/index.ts';
export { createLogger, type Logger, type LoggerOptions } from './lib/log.ts';
export { renderHtml, type HtmlOptions } from './reporters/html.ts';
export { toJson } from './reporters/json.ts';
export { renderMarkdown } from './reporters/markdown.ts';
export { renderPdf, writeReport, type Format, type WriteOptions } from './reporters/write.ts';
export {
  AREA_WEIGHTS,
  gradeFor,
  scoreChecks,
  scoreReport,
  type AreaWeights,
} from './scoring/score.ts';
export type * from './types.ts';
