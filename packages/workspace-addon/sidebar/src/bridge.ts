import type { AppState, DiffResult } from './types';

declare global {
  interface Window {
    google: {
      script: {
        run: {
          withSuccessHandler(cb: (result: any) => void): GoogleScriptRunner;
          withFailureHandler(cb: (error: Error) => void): GoogleScriptRunner;
        };
      };
    };
  }
}

interface GoogleScriptRunner {
  withSuccessHandler(cb: (result: any) => void): GoogleScriptRunner;
  withFailureHandler(cb: (error: Error) => void): GoogleScriptRunner;
  getInitialState(): void;
  getDocTitle(): void;
  createBaseline(): void;
  addSigners(payload: { selectedIds: string[]; customEmail: string }): void;
  signOff(payload: { commitMessage: string }): void;
  quickSign(payload: { message: string }): void;
  cancelSign(): void;
  simulateDrift(): void;
  resetDemo(): void;
  getDiff(signerId: string): void;
  getHistory(): void;
  goHome(): void;
}

function callServer<R>(fnName: string, ...args: any[]): Promise<R> {
  return new Promise((resolve, reject) => {
    const runner = window.google.script.run
      .withSuccessHandler((result: R) => resolve(result))
      .withFailureHandler((error: Error) => reject(error));

    const fn = (runner as any)[fnName];
    if (typeof fn !== 'function') {
      reject(new Error(`Server function "${fnName}" not found`));
      return;
    }
    fn.apply(runner, args);
  });
}

export const bridge = {
  getInitialState: (): Promise<{ view: string; state: AppState | null }> =>
    callServer('getInitialState'),

  getDocTitle: (): Promise<string> =>
    callServer('getDocTitle'),

  createBaseline: (): Promise<{ view: string; state: AppState }> =>
    callServer('createBaseline'),

  addSigners: (payload: { selectedIds: string[]; customEmail: string }): Promise<{ view: string; state: AppState }> =>
    callServer('addSigners', payload),

  signOff: (payload: { commitMessage: string }): Promise<{ view: string; state: AppState }> =>
    callServer('signOff', payload),

  quickSign: (payload: { message: string }): Promise<{ view: string; state: AppState }> =>
    callServer('quickSign', payload),

  cancelSign: (): Promise<{ view: string; state: AppState }> =>
    callServer('cancelSign'),

  simulateDrift: (): Promise<{ view: string; state: AppState }> =>
    callServer('simulateDrift'),

  resetDemo: (): Promise<{ view: string; state: AppState | null }> =>
    callServer('resetDemo'),

  getDiff: (signerId: string): Promise<DiffResult> =>
    callServer('getDiff', signerId),

  getHistory: (): Promise<{ entries: AppState['history']; docTitle: string }> =>
    callServer('getHistory'),

  goHome: (): Promise<{ view: string; state: AppState | null }> =>
    callServer('goHome'),
};
