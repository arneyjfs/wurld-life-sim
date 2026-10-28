/**
 * Playwright global setup — starts the Firebase Auth Emulator before all tests.
 *
 * ISOLATION STRATEGY:
 * - Auth Emulator runs on 127.0.0.1:9099 (configured in tests/e2e/firebase.json)
 * - Admin SDK does NOT connect to the emulator (talks to real Auth for token generation)
 * - Browser connects to Auth Emulator via EXPO_PUBLIC_AUTH_EMULATOR_URL env var
 * - Firestore stays REAL — no emulator, so browser and Cloud Functions share data
 * - Playwright route interception swaps emulator auth tokens → real tokens for function calls
 *
 * This file is referenced by playwright.config.ts globalSetup.
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '.env.test') });

const AUTH_EMULATOR_PORT = 9099;
const AUTH_EMULATOR_HOST = '127.0.0.1';
const PID_FILE = path.resolve(__dirname, '.emulator.pid');
const STARTUP_TIMEOUT_MS = 30_000;

/**
 * Check if a port is already in use.
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, AUTH_EMULATOR_HOST);
  });
}

/**
 * Wait for the Auth Emulator to be ready by polling the health endpoint.
 */
async function waitForEmulator(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${AUTH_EMULATOR_HOST}:${AUTH_EMULATOR_PORT}/`;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200 || res.status === 400) {
        return; // Emulator is accepting connections
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Auth Emulator did not start within ${timeoutMs}ms`);
}

async function globalSetup() {
  console.log('\n[global-setup] Starting Firebase Auth Emulator...');

  // Check if emulator is already running
  if (await isPortInUse(AUTH_EMULATOR_PORT)) {
    console.log(`[global-setup] Auth Emulator already running on port ${AUTH_EMULATOR_PORT}`);
    return;
  }

  // Resolve firebase-tools binary
  let firebaseBin: string;
  try {
    // Try local node_modules first
    const localBin = path.resolve(__dirname, 'node_modules/.bin/firebase');
    if (fs.existsSync(localBin)) {
      firebaseBin = localBin;
    } else {
      // Fall back to global
      firebaseBin = execSync('which firebase', { encoding: 'utf-8' }).trim();
    }
  } catch {
    throw new Error(
      'firebase-tools not found. Install it:\n  cd tests/e2e && npm install\n' +
      'Or globally: npm install -g firebase-tools',
    );
  }

  // Start the emulator from tests/e2e/ directory (uses tests/e2e/firebase.json)
  const emulator: ChildProcess = spawn(
    firebaseBin,
    ['emulators:start', '--only', 'auth', '--project', 'demo-wurlds'],
    {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );

  // Log emulator output for debugging
  emulator.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[auth-emulator] ${line}`);
  });
  emulator.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line && !line.includes('Logging to')) {
      console.log(`[auth-emulator:err] ${line}`);
    }
  });

  // Save PID for teardown
  if (emulator.pid) {
    fs.writeFileSync(PID_FILE, String(emulator.pid));
    // Unref so the test process can exit even if the emulator is still running
    emulator.unref();
  }

  // Wait for the emulator to be ready
  try {
    await waitForEmulator(STARTUP_TIMEOUT_MS);
    console.log(`[global-setup] Auth Emulator ready on ${AUTH_EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`);
  } catch (err) {
    // Kill the emulator if it didn't start properly
    if (emulator.pid) {
      try { process.kill(-emulator.pid, 'SIGTERM'); } catch {}
    }
    throw err;
  }
}

export default globalSetup;
