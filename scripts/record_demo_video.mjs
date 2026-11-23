#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEMO_DIR = path.join(ROOT, 'demo');
const FRAMES_DIR = path.join(DEMO_DIR, 'frames');
const OUTPUT_MP4 = path.join(DEMO_DIR, 'liveedge-even-g2-demo.mp4');

function findChromiumExecutable() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH && fs.existsSync(process.env.CHROMIUM_EXECUTABLE_PATH)) {
    return process.env.CHROMIUM_EXECUTABLE_PATH;
  }
  const searchRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);

  for (const cacheDir of searchRoots) {
    if (fs.existsSync(cacheDir)) {
      for (const entry of fs.readdirSync(cacheDir)) {
        if (entry.startsWith('chromium')) {
          const walk = (dir) => {
            for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, f.name);
              if (f.isDirectory()) {
                const hit = walk(full);
                if (hit) return hit;
              } else if (f.name === 'chrome-headless-shell' || f.name === 'chrome') {
                return full;
              }
            }
            return null;
          };
          const found = walk(path.join(cacheDir, entry));
          if (found) return found;
        }
      }
    }
  }
  for (const sysBin of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (fs.existsSync(sysBin)) return sysBin;
  }
  return undefined;
}

/**
 * Generates a clean, subtle stereo WAV soundtrack with futuristic optical HUD tactile chimes
 * synchronized to the 5 choreographed acts (zero robotic TTS, subtle dark ambient + crisp bleeps).
 */
function synthesizeTactileAudioWav(wavPath, durationSec) {
  const sampleRate = 44100;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const buffer = Buffer.alloc(44 + totalSamples * 2); // 16-bit mono PCM

  // Write WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + totalSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // 1 channel
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(totalSamples * 2, 40);

  // Cue timestamps matching app.ts startChoreographedDemoReel()
  const cues = [
    { t: 0.25, freqs: [523.25, 659.25], len: 0.24, amp: 0.11 }, // Boot chime
    { t: 5.55, freqs: [220.0], len: 0.18, amp: 0.09 },          // Silent block low pulse
    { t: 11.55, freqs: [783.99, 987.77], len: 0.22, amp: 0.12 }, // HUD Edge card pop
    { t: 15.85, freqs: [392.0], len: 0.12, amp: 0.09 },          // Temple swipe whoosh-tap
    { t: 19.05, freqs: [783.99, 1046.5], len: 0.26, amp: 0.13 }, // Decisive NBA Clutch alert
    { t: 23.82, freqs: [1174.66], len: 0.06, amp: 0.14 },        // Double-tap click 1
    { t: 23.94, freqs: [1318.51, 1567.98], len: 0.32, amp: 0.14 }, // Double-tap confirm fill chord
    { t: 29.6, freqs: [246.94], len: 0.18, amp: 0.09 },          // Esports whale trap blocked
    { t: 34.05, freqs: [880.0, 1174.66], len: 0.26, amp: 0.13 }, // Baron Steal HUD alert
    { t: 38.02, freqs: [1174.66], len: 0.06, amp: 0.14 },        // R1 Ring double-tap 1
    { t: 38.14, freqs: [1318.51, 1760.0], len: 0.34, amp: 0.14 }, // R1 Ring confirm chord
  ];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Ultra-subtle warm sub-pad (-36dB) with smooth fade-in / fade-out
    const envGlobal = Math.min(1, t / 1.2, (durationSec - t) / 1.5);
    let sample = Math.sin(2 * Math.PI * 110 * t) * 0.014 * Math.max(0, envGlobal);

    for (const cue of cues) {
      if (t >= cue.t && t <= cue.t + cue.len) {
        const dt = t - cue.t;
        const env = Math.exp((-dt * 7.5) / cue.len) * Math.min(1, dt / 0.006);
        for (const f of cue.freqs) {
          sample += (Math.sin(2 * Math.PI * f * dt) * cue.amp * env) / cue.freqs.length;
        }
      }
    }

    const clamped = Math.max(-0.95, Math.min(0.95, sample));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  fs.writeFileSync(wavPath, buffer);
}

async function main() {
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  console.log('[DEMO-RECORDER] Building production bundle...');
  execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });

  const port = 4288;
  const server = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(port), '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'pipe' }
  );
  await new Promise((r) => setTimeout(r, 1600));

  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });

  const fps = 30;
  const durationSec = 47;
  const totalFrames = fps * durationSec;

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    console.log('[DEMO-RECORDER] Opening LiveEdge HUD Studio at 1920x1080 (?demo=1&manualStep=1)...');
    await page.goto(`http://127.0.0.1:${port}/?demo=1&manualStep=1`, { waitUntil: 'networkidle' });

    // Frame-accurate deterministic stepping (zero wall-clock drift, Remotion-style frame sync)
    for (let frame = 0; frame < totalFrames; frame++) {
      const tMs = (frame * 1000) / fps;
      await page.evaluate(async (ms) => {
        if (typeof window.__stepDemoAtTimeMs === 'function') {
          await window.__stepDemoAtTimeMs(ms);
        }
      }, tMs);
      const framePath = path.join(FRAMES_DIR, `frame_${String(frame).padStart(5, '0')}.jpg`);
      await page.screenshot({ path: framePath, type: 'jpeg', quality: 94 });
      if (frame === 716) {
        fs.copyFileSync(framePath, path.join(DEMO_DIR, 'preview-hud.jpg'));
      }
      if (frame % 150 === 0 || frame === totalFrames - 1) {
        const st = await page.evaluate(() => window.__demoState);
        console.log(
          `[DEMO-RECORDER] Frame ${frame}/${totalFrames} (${(tMs / 1000).toFixed(1)}s) | Act=${st?.actIndex ?? 0} | HUD=${st?.hudMode ?? ''} | Receipts=${st?.receiptCount ?? 0}`
        );
      }
    }

    await context.close();
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  const wavPath = path.join(DEMO_DIR, 'hud_soundtrack.wav');
  synthesizeTactileAudioWav(wavPath, durationSec);

  console.log('[DEMO-RECORDER] Encoding 1920x1080 30fps H.264 MP4 via FFmpeg...');
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(FRAMES_DIR, 'frame_%05d.jpg'),
      '-i',
      wavPath,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-shortest',
      '-movflags',
      '+faststart',
      OUTPUT_MP4,
    ],
    { cwd: ROOT, stdio: 'inherit' }
  );

  // Clean temporary frame JPEGs and wav
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.rmSync(wavPath, { force: true });

  const stat = fs.statSync(OUTPUT_MP4);
  console.log(`\n✅ HD Demo Video Ready: ${OUTPUT_MP4} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)\n`);
}

main().catch((err) => {
  console.error('Demo recording failed:', err);
  process.exit(1);
});
