/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
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
import { renderHook } from '@testing-library/react';
import { useGitBranchName } from './useGitBranchName.js';
import { fs, vol } from 'memfs'; // For mocking fs
import { EventEmitter } from 'node:events';
import { exec as mockExec, type ChildProcess, type ExecOptions } from 'node:child_process';
import type { FSWatcher } from 'memfs/lib/volume.js';

// Mock child_process
vi.mock('child_process');

// Mock fs and fs/promises
vi.mock('node:fs', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs');
  return memfs.fs;
});

vi.mock('node:fs/promises', async () => {
  const memfs = await vi.importActual<typeof import('memfs')>('memfs');
  const mockAccess = vi.fn().mockResolvedValue(undefined);
  return {
    ...memfs.fs.promises,
    access: mockAccess,
  };
});

const CWD = '/test/project';
const GIT_HEAD_PATH = `${CWD}/.git/HEAD`;

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe('useGitBranchName', () => {
  beforeEach(() => {
    vol.reset(); // Reset in-memory filesystem
    vol.fromJSON({
      [GIT_HEAD_PATH]: 'ref: refs/heads/main',
    });
    vi.useFakeTimers(); // Use fake timers for async operations
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it('should return branch name', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command: string, _options: ExecOptions, callback?: ExecCallback) => {
        callback?.(null, 'main\n', '');
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers(); // Advance timers to trigger useEffect and exec callback
      rerender(); // Rerender to get the updated state
    });

    expect(result.current).toBe('main');
  });

  it('should return undefined if git command fails', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command: string, _options: ExecOptions, callback?: ExecCallback) => {
        callback?.(new Error('Git error'), '', 'error output');
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));
    expect(result.current).toBeUndefined();

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBeUndefined();
  });

  it('should return short commit hash if branch is HEAD (detached state)', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (command: string, _options: ExecOptions, callback?: ExecCallback) => {
        if (command === 'git rev-parse --abbrev-ref HEAD') {
          callback?.(null, 'HEAD\n', '');
        } else if (command === 'git rev-parse --short HEAD') {
          callback?.(null, 'a1b2c3d\n', '');
        }
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));
    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('a1b2c3d');
  });

  it('should return undefined if branch is HEAD and getting commit hash fails', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (command: string, _options: ExecOptions, callback?: ExecCallback) => {
        if (command === 'git rev-parse --abbrev-ref HEAD') {
          callback?.(null, 'HEAD\n', '');
        } else if (command === 'git rev-parse --short HEAD') {
          callback?.(new Error('Git error'), '', 'error output');
        }
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));
    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBeUndefined();
  });

  it('should update branch name when .git/logs/HEAD changes', async () => {
    const gitLogsHeadPath = `${CWD}/.git/logs/HEAD`;
    
    // Create .git/logs/HEAD file for the watcher to watch
    vol.fromJSON({
      [GIT_HEAD_PATH]: 'ref: refs/heads/main',
      [gitLogsHeadPath]: 'initial log content',
    });


    let watchCallback: ((event: string, filename: string | null) => void) | undefined;
    const watchMock = vi.spyOn(fs, 'watch').mockImplementation((_path: string, callback: any) => {
      watchCallback = callback;
      return {
        close: vi.fn(),
      } as unknown as FSWatcher;
    });

    let callCount = 0;
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command: string, _options: ExecOptions, callback?: ExecCallback) => {
        const branchName = callCount === 0 ? 'main\n' : 'develop\n';
        callCount++;
        callback?.(null, branchName, '');
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('main');

    // Wait for async watcher setup
    await vi.waitFor(() => {
      expect(watchMock).toHaveBeenCalled();
    });

    // Simulate file change event by triggering the watcher callback
    await act(async () => {
      watchCallback?.('change', null);
      vi.runAllTimers();
      rerender();
    });

    expect(result.current).toBe('develop');
    expect(watchMock).toHaveBeenCalledWith(gitLogsHeadPath, expect.any(Function));
  });

  it('should handle watcher setup error silently', async () => {
    const gitLogsHeadPath = `${CWD}/.git/logs/HEAD`;
    
    // Only create .git/HEAD but not .git/logs/HEAD to cause watcher setup to fail
    vol.fromJSON({
      [GIT_HEAD_PATH]: 'ref: refs/heads/main',
    });

    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command: string, _options: ExecOptions, callback?: ExecCallback) => {
        callback?.(null, 'main\n', '');
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });

    expect(result.current).toBe('main'); // Branch name should still be fetched initially

    // Try to trigger a change that would normally be caught by the watcher
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command: string, _options: ExecOptions, callback?: ExecCallback) => {
        callback?.(null, 'develop\n', '');
        return new EventEmitter() as ChildProcess;
      },
    );

    // Create the logs directory and file now and write to it
    vol.fromJSON({
      [GIT_HEAD_PATH]: 'ref: refs/heads/main',
      [gitLogsHeadPath]: 'some content',
    });

    await act(async () => {
      fs.writeFileSync(gitLogsHeadPath, 'updated content');
      vi.runAllTimers();
      rerender();
    });

    // Branch name should not change because watcher setup failed initially
    expect(result.current).toBe('main');
  });

  it('should cleanup watcher on unmount', async () => {
    const closeMock = vi.fn();
    const watchMock = vi.spyOn(fs, 'watch').mockReturnValue({
      close: closeMock,
    } as unknown as FSWatcher);

    // Create .git/logs/HEAD file for the watcher to watch
    const gitLogsHeadPath = `${CWD}/.git/logs/HEAD`;
    vol.fromJSON({
      [GIT_HEAD_PATH]: 'ref: refs/heads/main',
      [gitLogsHeadPath]: 'some log content',
    });


    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command: string, _options: ExecOptions, callback?: ExecCallback) => {
        callback?.(null, 'main\n', '');
        return new EventEmitter() as ChildProcess;
      },
    );

    const { unmount, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });

    // Wait for async watcher setup
    await vi.waitFor(() => {
      expect(watchMock).toHaveBeenCalled();
    });

    // Watcher should be set up by now
    expect(watchMock).toHaveBeenCalledWith(gitLogsHeadPath, expect.any(Function));

    unmount();
    expect(closeMock).toHaveBeenCalled();
  });
});
