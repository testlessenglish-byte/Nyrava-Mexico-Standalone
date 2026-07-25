// Request-scoped active user for AI routing.
//
// The pipeline runner (and other top-level entry points) wraps a run with
// `withAIUser(userId, fn)`, so every downstream callGroq invocation can
// resolve the caller's active AI provider from `user_ai_keys` without
// threading userId through 30+ engine call sites.
import { AsyncLocalStorage } from "node:async_hooks";

const _als = new AsyncLocalStorage<{ userId: string }>();

export function withAIUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return _als.run({ userId }, fn);
}

export function getCurrentAIUser(): string | undefined {
  return _als.getStore()?.userId;
}
