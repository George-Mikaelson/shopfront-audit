import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Launcher } from 'chrome-launcher';
import { chromium } from 'playwright';

/**
 * Chromium binaries worth trying for Lighthouse, best first:
 *   1. $CHROME_PATH
 *   2. the Chromium Playwright installed (`npx playwright install chromium`)
 *   3. Playwright's headless shell build
 *   4. any Chrome installed on the system
 */
export function chromeCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const list: string[] = [];
  const fromEnv = env.CHROME_PATH?.trim();
  if (fromEnv) list.push(fromEnv);
  try {
    const bundled = chromium.executablePath();
    list.push(bundled);
    // .../ms-playwright/chromium-1255/chrome-win64/chrome.exe -> .../ms-playwright
    const root = dirname(dirname(dirname(bundled)));
    for (const dir of safeReaddir(root).filter((d) => d.startsWith('chromium_headless_shell-'))) {
      for (const sub of safeReaddir(join(root, dir))) {
        for (const exe of ['chrome-headless-shell.exe', 'chrome-headless-shell']) {
          list.push(join(root, dir, sub, exe));
        }
      }
    }
  } catch {
    /* playwright browsers not installed */
  }
  try {
    list.push(...Launcher.getInstallations());
  } catch {
    /* no system Chrome */
  }
  return [...new Set(list)].filter((p) => existsSync(p));
}

let resolved: Promise<string> | undefined;

/**
 * First candidate that actually starts. Some machines have a Chromium that is
 * present but blocked from running (antivirus, app control), so existence is
 * not enough. The result is cached for the process.
 */
export function resolveChromePath(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  resolved ??= (async () => {
    const candidates = chromeCandidates(env);
    for (const path of candidates) {
      if (await canStart(path)) return path;
    }
    throw new Error(
      candidates.length === 0
        ? 'No Chromium found. Run `npx playwright install chromium` or set CHROME_PATH.'
        : `None of these browsers could be started: ${candidates.join(', ')}. Set CHROME_PATH.`,
    );
  })();
  return resolved;
}

function canStart(path: string): Promise<boolean> {
  const profile = mkdtempSync(join(tmpdir(), 'shopfront-probe-'));
  return new Promise((done) => {
    const finish = (ok: boolean) => {
      done(ok);
      setTimeout(() => {
        rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
      }, 500).unref();
    };
    try {
      const child = spawn(
        path,
        ['--headless=new', '--no-first-run', `--user-data-dir=${profile}`, 'about:blank'],
        {
          stdio: 'ignore',
        },
      );
      child.once('error', () => {
        finish(false);
      });
      child.once('spawn', () => {
        child.kill();
        finish(true);
      });
    } catch {
      finish(false);
    }
  });
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
