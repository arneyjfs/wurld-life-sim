/**
 * Playwright global teardown — stops the Firebase Auth Emulator after all tests.
 *
 * Reads the PID file written by global-setup.ts and kills the emulator process.
 */

import fs from 'fs';
import path from 'path';

const PID_FILE = path.resolve(__dirname, '.emulator.pid');

async function globalTeardown() {
  console.log('\n[global-teardown] Stopping Firebase Auth Emulator...');

  if (!fs.existsSync(PID_FILE)) {
    console.log('[global-teardown] No PID file found — emulator may have been external');
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  fs.unlinkSync(PID_FILE);

  if (!pid || isNaN(pid)) {
    console.log('[global-teardown] Invalid PID — skipping');
    return;
  }

  try {
    // Kill the process group (negative PID) since we spawned with detached: true
    process.kill(-pid, 'SIGTERM');
    console.log(`[global-teardown] Sent SIGTERM to emulator process group ${pid}`);
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      console.log('[global-teardown] Emulator already stopped');
    } else {
      console.warn(`[global-teardown] Error stopping emulator: ${err.message}`);
    }
  }

  // Give it a moment to shut down
  await new Promise((r) => setTimeout(r, 1_000));

  // Force kill if still running
  try {
    process.kill(-pid, 0); // Check if still alive
    process.kill(-pid, 'SIGKILL');
    console.log('[global-teardown] Force-killed emulator');
  } catch {
    // Already gone — good
  }
}

export default globalTeardown;
