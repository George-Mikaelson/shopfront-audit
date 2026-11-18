import { readFileSync } from 'node:fs';

// src/version.ts and dist/version.js both sit one level below package.json.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
};

export const TOOL_NAME = pkg.name;
export const TOOL_VERSION = pkg.version;
export const USER_AGENT = `${pkg.name}/${pkg.version} (+https://github.com/George-Mikaelson/shopfront-audit)`;
