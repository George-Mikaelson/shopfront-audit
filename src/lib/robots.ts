import robotsParserModule from 'robots-parser';

/**
 * robots-parser is CommonJS (`module.exports = fn`) but its typings declare an
 * ES default export, which NodeNext resolution reads as `{ default: fn }`.
 */
const robotsParser = robotsParserModule as unknown as (typeof robotsParserModule)['default'];

export type Robots = ReturnType<typeof robotsParser>;

/** Parses robots.txt for `pageUrl`'s origin. */
export function parseRobots(pageUrl: string, body: string): Robots {
  return robotsParser(new URL('/robots.txt', pageUrl).href, body);
}
