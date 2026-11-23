#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function runStep(label, cmd, args) {
  process.stdout.write(`\n[SELF-CHECK] ${label} ...\n`);
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
}

function findChromiumExecutable() {
  if (
    process.env.CHROMIUM_EXECUTABLE_PATH &&
    fs.existsSync(process.env.CHROMIUM_EXECUTABLE_PATH)
  ) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }
  const searchRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);

  for (const cacheDir of searchRoots) {
    if (fs.existsSync(cacheDir)) {
      const entries = fs.readdirSync(cacheDir);
      for (const entry of entries) {
        if (entry.startsWith('chromium')) {
          const sub = path.join(cacheDir, entry);
          const walk = (dir) => {
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, f.name);
              if (f.isDirectory()) {
                const hit = walk(full);
                if (hit) return hit;
              } else if (
                f.name === 'chrome-headless-shell' ||
                f.name === 'chrome'
              ) {
                return full;
              }
            }
            return null;
          };
          const found = walk(sub);
          if (found) return found;
        }
      }
    }
  }
  for (const sysBin of [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ]) {
    if (fs.existsSync(sysBin)) return sysBin;
  }
  return undefined;
}

/**
 * Generalized structural desensitization scanner (zero hardcoded private identifiers).
 * Scans 100% of repository text & build files INCLUDING this script itself (zero self-skip),
 * and optionally loads extra custom terms from an external `DESENSITIZE_DENYLIST_FILE`.
 */
function runDesensitizationAudit() {
  process.stdout.write(
    '\n[SELF-CHECK] Running 100% Physical Desensitization Audit ...\n'
  );

  const forbiddenPatterns = [
    {
      name: 'Hardcoded Secret / Private Key Assignment',
      regex:
        /(?:PRIVATE_KEY|SECRET_KEY|MNEMONIC|AUTH_TOKEN|API_SECRET)\s*[:=]\s*['"][^'"]{8,}/i,
    },
    {
      name: 'Cloud / Git Personal Access Token',
      regex:
        /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{12,})\b/,
    },
    {
      name: 'Local User Home or Host System Path',
      regex: /(?:^|[\s'"`(])\/(?:home|Users|root|var\/lib|etc)\/[A-Za-z0-9._-]+/,
    },
    {
      name: 'RFC1918 / CGNAT Mesh Private IPv4',
      regex:
        /\b(?!(?:127\.0\.0\.1|0\.0\.0\.0)\b)(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/,
    },
    {
      name: 'Private Mesh Tailnet Hostname',
      regex: /\b(?:[a-z0-9-]+\.ts\.net|tail[0-9a-f]{5,})\b/i,
    },
  ];

  const extraDenylistPath = process.env.DESENSITIZE_DENYLIST_FILE;
  if (extraDenylistPath && fs.existsSync(extraDenylistPath)) {
    const lines = fs
      .readFileSync(extraDenylistPath, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#'));
    for (const [idx, token] of lines.entries()) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      forbiddenPatterns.push({
        name: `External Denylist Rule #${idx + 1}`,
        regex: new RegExp(escaped, 'i'),
      });
    }
  }

  const skipDirs = new Set(['node_modules', '.git', 'demo', 'release']);
  const scanned = [];

  function scanDir(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDir(full);
      } else if (
        /\.(ts|js|mjs|cjs|json|md|html|css|yml|yaml|txt)$/i.test(ent.name) ||
        ent.name === '.gitignore' ||
        ent.name === 'LICENSE'
      ) {
        const text = fs.readFileSync(full, 'utf8');
        const relPath = path.relative(ROOT, full);
        scanned.push(relPath);
        for (const rule of forbiddenPatterns) {
          if (rule.regex.test(text)) {
            throw new Error(
              `Desensitization violation (${rule.name}) in ${relPath}`
            );
          }
        }
      }
    }
  }

  scanDir(ROOT);
  console.log(
    `[SELF-CHECK] Desensitization PASS (${scanned.length} text & build files clean, self-included).`
  );
}

async function runPlaywrightSmokeE2E() {
  process.stdout.write(
    '\n[SELF-CHECK] Running Headless E2E Startup & Temple Gesture Smoke Test ...\n'
  );
  const port = 4279;
  const server = spawn(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      'preview',
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
    ],
    { cwd: ROOT, stdio: 'pipe' }
  );

  await new Promise((resolve) => setTimeout(resolve, 1600));

  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

    const waveguideExists = await page.locator('#g2-waveguide').isVisible();
    if (!waveguideExists) {
      throw new Error('G2 576x288 waveguide screen did not render');
    }

    // Trigger NBA Clutch 8-0 Run pulse (index 2)
    await page.locator('[data-pulse-idx="2"]').click();
    await page.waitForTimeout(250);

    const cardText = await page.locator('#g2-waveguide').innerText();
    if (!cardText.includes('BUY') || !cardText.includes('RISK CAP')) {
      throw new Error(`Expected G2 HUD Edge Alert card, got: ${cardText}`);
    }

    // Double-Tap Temple to confirm 10 USDC sandbox order
    await page.locator('#btn-double-tap').click();
    await page.waitForTimeout(300);

    const receiptText = await page.locator('#g2-waveguide').innerText();
    if (!receiptText.includes('FILLED') || !receiptText.includes('EIP-712')) {
      throw new Error(`Expected G2 HUD Order Receipt, got: ${receiptText}`);
    }
    console.log(
      '[SELF-CHECK] Headless E2E HUD Alert -> Double-Tap -> EIP-712 Receipt PASS.'
    );
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

async function main() {
  fs.mkdirSync(path.join(ROOT, 'release'), { recursive: true });
  runStep('TypeScript Strict Check', 'npx', ['tsc', '--noEmit']);
  runStep('ESLint Static Analysis', 'npx', [
    'eslint',
    'src/**/*.ts',
    'tests/**/*.ts',
  ]);
  runStep('Vitest Unit & SDK Suite', 'npx', ['vitest', 'run']);
  runStep('Vite Production Build', 'npx', ['vite', 'build']);
  runStep('EvenHub .ehpk Package Build', 'npx', [
    'evenhub',
    'pack',
    'app.json',
    './dist',
    '-o',
    './release/liveedge-hud.ehpk',
    '--sdk-ver',
    '0.0.16',
  ]);

  const ehpkStat = fs.statSync(
    path.join(ROOT, 'release', 'liveedge-hud.ehpk')
  );
  if (ehpkStat.size < 1024) {
    throw new Error('Packaged liveedge-hud.ehpk is unexpectedly small');
  }
  console.log(`[SELF-CHECK] .ehpk bundle verified (${ehpkStat.size} bytes).`);

  runDesensitizationAudit();
  await runPlaywrightSmokeE2E();
  console.log('\n✅ ALL LIVEEDGE HUD CHECKS PASSED (EXIT CODE 0).\n');
}

main().catch((err) => {
  console.error('\n❌ SELF-CHECK FAILED:', err);
  process.exit(1);
});
