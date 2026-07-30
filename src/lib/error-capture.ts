// Captures the last unhandled server-side error so the SSR entry can surface a
// real stack trace when h3 swallows the throw into a generic 500 JSON body.
let lastCapturedError: unknown;

export function captureError(error: unknown): void {
  lastCapturedError = error;
}

export function consumeLastCapturedError(): unknown {
  const error = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}

const globalScope = globalThis as typeof globalThis & {
  __nyravaErrorCaptureInstalled?: boolean;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
};

if (!globalScope.__nyravaErrorCaptureInstalled) {
  globalScope.__nyravaErrorCaptureInstalled = true;
  globalScope.addEventListener?.("unhandledrejection", (event: unknown) => {
    captureError((event as { reason?: unknown } | undefined)?.reason ?? event);
  });
  globalScope.addEventListener?.("error", (event: unknown) => {
    captureError((event as { error?: unknown } | undefined)?.error ?? event);
  });
}
