/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import util from 'util';
import { ConsoleMessageItem } from '../types.js';

interface ConsolePatcherParams {
  onNewMessage: (message: Omit<ConsoleMessageItem, 'id'>) => void;
  debugMode: boolean;
}

export class ConsolePatcher {
  private originalConsoleLog = console.log;
  private originalConsoleWarn = console.warn;
  private originalConsoleError = console.error;
  private originalConsoleDebug = console.debug;

  private params: ConsolePatcherParams;

  constructor(params: ConsolePatcherParams) {
    this.params = params;
  }

  patch() {
    console.log = this.patchConsoleMethod('log', this.originalConsoleLog);
    console.warn = this.patchConsoleMethod('warn', this.originalConsoleWarn);
    console.error = this.patchConsoleMethod('error', this.originalConsoleError);
    console.debug = this.patchConsoleMethod('debug', this.originalConsoleDebug);
  }

  cleanup = () => {
    console.log = this.originalConsoleLog;
    console.warn = this.originalConsoleWarn;
    console.error = this.originalConsoleError;
    console.debug = this.originalConsoleDebug;
  };

  private formatArgs = (args: unknown[]): string => util.format(...args);

  private patchConsoleMethod =
    (
      type: 'log' | 'warn' | 'error' | 'debug',
      originalMethod: (...args: unknown[]) => void,
    ) =>
    (...args: unknown[]) => {
      if (this.params.debugMode) {
        originalMethod.apply(console, args);
      }

      if (type !== 'debug' || this.params.debugMode) {
        this.params.onNewMessage({
          type,
          content: this.formatArgs(args),
          count: 1,
        });
      }
    };
}
