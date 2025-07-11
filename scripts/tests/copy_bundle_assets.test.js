/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const bundleDir = join(root, 'bundle');

describe('copy_bundle_assets', () => {
  beforeAll(() => {
    // Ensure bundle directory exists
    if (!existsSync(bundleDir)) {
      mkdirSync(bundleDir);
    }
  });

  it('should create backwards compatibility files for old seatbelt profile names', () => {
    // Run the copy script
    execSync(`node ${join(root, 'scripts/copy_bundle_assets.js')}`, {
      cwd: root,
      stdio: 'pipe', // Suppress output during tests
    });

    // Check that the backwards compatibility files were created
    expect(existsSync(join(bundleDir, 'sandbox-macos-minimal.sb'))).toBe(true);
    expect(existsSync(join(bundleDir, 'sandbox-macos-strict.sb'))).toBe(true);

    // Also check that the new files exist
    expect(
      existsSync(join(bundleDir, 'sandbox-macos-permissive-open.sb')),
    ).toBe(true);
    expect(
      existsSync(join(bundleDir, 'sandbox-macos-restrictive-closed.sb')),
    ).toBe(true);
  });
});
