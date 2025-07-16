/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * NOTE: Two tests in this file are skipped due to memfs limitations with fs.watch.
 * While it would be beneficial to re-enable these tests to prevent regressions,
 * the current mocking setup with memfs makes it technically challenging to test
 * fs.watch behavior reliably. These functionalities are covered by integration tests.
 *
 * TODO: Consider using a different mocking strategy or real file system tests
 * in a temp directory to properly test watcher functionality.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  MockedFunction,
} from 'vitest';
import { act } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useGitBranchName } from './useGitBranchName.js';
import { vol } from 'memfs'; // For mocking fs
import * as nodeFs from 'node:fs'; // Import the actual fs module that the hook uses
import * as nodeFsPromises from 'node:fs/promises'; // Import fs/promises to spy on access
import { EventEmitter } from 'node:events';
import { exec as mockExec, type ChildProcess } from 'node:child_process';

// Mock child_process
vi.mock('child_process');

// Mock fs and fs/promises
vi.mock('node:fs', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs');
  const originalFs = await vi.importActual<typeof import('fs')>('node:fs');
  return {
    ...memfs.fs,
    constants: originalFs.constants,
    // Keep watch unmocked so we can spy on it in tests
    watch: originalFs.watch,
  };
});

vi.mock('node:fs/promises', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs');
  return memfs.fs.promises;
});

const CWD = '/test/project';
const GIT_HEAD_PATH = `${CWD}/.git/HEAD`;
const GIT_LOGS_HEAD_PATH = `${CWD}/.git/logs/HEAD`;

describe('useGitBranchName', () => {
  beforeEach(() => {
    vol.reset(); // Reset in-memory filesystem
    vol.fromJSON({
      [GIT_HEAD_PATH]: 'ref: refs/heads/main',
      [GIT_LOGS_HEAD_PATH]: 'initial logs',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return branch name', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        // Execute callback asynchronously to simulate real behavior
        setTimeout(() => callback?.(null, 'main\n', ''), 0);
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result } = renderHook(() => useGitBranchName(CWD));

    // Wait for the async exec callback to complete
    await waitFor(() => {
      expect(result.current).toBe('main');
    });
  });

  it('should return undefined if git command fails', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        setTimeout(
          () => callback?.(new Error('Git error'), '', 'error output'),
          0,
        );
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result } = renderHook(() => useGitBranchName(CWD));

    // Initial state should be undefined
    expect(result.current).toBeUndefined();

    await waitFor(() => {
      expect(
        (mockExec as MockedFunction<typeof mockExec>).mock.calls,
      ).toHaveLength(1);
    });
    expect(result.current).toBeUndefined();
  });

  it('should return short commit hash if branch is HEAD (detached state)', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (command, _options, callback) => {
        setTimeout(() => {
          if (command === 'git rev-parse --abbrev-ref HEAD') {
            callback?.(null, 'HEAD\n', '');
          } else if (command === 'git rev-parse --short HEAD') {
            callback?.(null, 'a1b2c3d\n', '');
          }
        }, 0);
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result } = renderHook(() => useGitBranchName(CWD));

    await waitFor(() => {
      expect(result.current).toBe('a1b2c3d');
    });
  });

  it('should return undefined if branch is HEAD and getting commit hash fails', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (command, _options, callback) => {
        setTimeout(() => {
          if (command === 'git rev-parse --abbrev-ref HEAD') {
            callback?.(null, 'HEAD\n', '');
          } else if (command === 'git rev-parse --short HEAD') {
            callback?.(new Error('Git error'), '', 'error output');
          }
        }, 0);
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result } = renderHook(() => useGitBranchName(CWD));

    await waitFor(() => {
      expect(
        (mockExec as MockedFunction<typeof mockExec>).mock.calls,
      ).toHaveLength(2);
    });
    expect(result.current).toBeUndefined();
  });

  it.skip('should update branch name when .git/logs/HEAD changes', async () => {
    // SKIP REASON: The fs.watch functionality has been fixed to mock the correct module,
    // but the async nature of setupWatcher in the hook still makes it challenging to test reliably
    // in a unit test environment. The watcher functionality is covered by integration tests.
    // Set up fs.watch spy on the correct module
    let watchCallback:
      | ((eventType: string, filename?: string) => void)
      | undefined;
    const watchSpy = vi
      .spyOn(nodeFs, 'watch')
      .mockImplementation(
        (_path: nodeFs.PathLike, callback?: nodeFs.WatchListener<string>) => {
          watchCallback = callback as (
            eventType: string,
            filename?: string,
          ) => void;
          return {
            close: vi.fn(),
          } as unknown as nodeFs.FSWatcher;
        },
      );

    // Spy on fsPromises.access to see if it's being called and what happens
    const accessSpy = vi
      .spyOn(nodeFsPromises, 'access')
      .mockResolvedValue(undefined);

    let callCount = 0;
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        const branchName =
          callCount === 0
            ? 'main\n'
            : callCount === 1
              ? 'develop\n'
              : 'feature\n';
        callCount++;
        setTimeout(() => callback?.(null, branchName, ''), 0);
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result } = renderHook(() => useGitBranchName(CWD));

    // Wait for initial branch name
    await waitFor(() => {
      expect(result.current).toBe('main');
    });

    // Wait for the watcher to be set up (with longer timeout for async setup)
    await waitFor(
      () => {
        expect(watchSpy).toHaveBeenCalledWith(
          GIT_LOGS_HEAD_PATH,
          expect.any(Function),
        );
      },
      { timeout: 3000 },
    );

    expect(watchCallback).toBeDefined();

    // Trigger a change event
    act(() => {
      watchCallback!('change');
    });

    // Wait for the branch name to update
    await waitFor(() => {
      expect(result.current).toBe('develop');
    });

    // Test rename event as well
    act(() => {
      watchCallback!('rename');
    });

    // Wait for the branch name to update again
    await waitFor(() => {
      expect(result.current).toBe('feature');
    });

    // Restore the spies
    watchSpy.mockRestore();
    accessSpy.mockRestore();
  });

  it('should handle watcher setup error silently', async () => {
    // Remove .git/logs/HEAD to cause an error in fs.watch setup
    vol.unlinkSync(GIT_LOGS_HEAD_PATH);

    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        setTimeout(() => callback?.(null, 'main\n', ''), 0);
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result } = renderHook(() => useGitBranchName(CWD));

    // Wait for initial branch name
    await waitFor(() => {
      expect(result.current).toBe('main');
    });

    // Mock exec to return a different branch name
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        setTimeout(() => callback?.(null, 'develop\n', ''), 0);
        return new EventEmitter() as ChildProcess;
      },
    );

    // Re-create the file and try to trigger a change
    vol.fromJSON({
      [GIT_LOGS_HEAD_PATH]: 'new log entry',
    });

    // Since watcher setup failed, an update to 'develop' should not happen.
    // We can assert that waiting for this state change times out.
    await expect(
      waitFor(() => expect(result.current).toBe('develop'), {
        timeout: 100,
      }),
    ).rejects.toThrow();

    // The branch name should remain 'main'.
    expect(result.current).toBe('main');
  });

  it.skip('should cleanup watcher on unmount', async () => {
    // SKIP REASON: The fs.watch functionality has been fixed to mock the correct module,
    // but the async nature of setupWatcher in the hook still makes it challenging to test reliably
    // in a unit test environment. The cleanup functionality is covered by integration tests.
    // Set up fs.watch spy on the correct module
    const closeMock = vi.fn();
    const watchSpy = vi.spyOn(nodeFs, 'watch').mockImplementation(
      (_path: nodeFs.PathLike, _callback?: nodeFs.WatchListener<string>) =>
        ({
          close: closeMock,
        }) as unknown as nodeFs.FSWatcher,
    );

    // Spy on fsPromises.access to ensure it resolves
    const accessSpy = vi
      .spyOn(nodeFsPromises, 'access')
      .mockResolvedValue(undefined);

    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        setTimeout(() => callback?.(null, 'main\n', ''), 0);
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, unmount } = renderHook(() => useGitBranchName(CWD));

    // Wait for initial branch fetch
    await waitFor(() => {
      expect(result.current).toBe('main');
    });

    // Wait for the watcher to be set up (with longer timeout for async setup)
    await waitFor(
      () => {
        expect(watchSpy).toHaveBeenCalledWith(
          GIT_LOGS_HEAD_PATH,
          expect.any(Function),
        );
      },
      { timeout: 3000 },
    );

    // Unmount and verify cleanup
    unmount();
    expect(closeMock).toHaveBeenCalledTimes(1);

    // Restore the spies
    watchSpy.mockRestore();
    accessSpy.mockRestore();
  });
});
