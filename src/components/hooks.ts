/**
 * Hooks - Functional component utilities
 */

import { store } from '../core/store';
import type { AppState } from '../types';

type Selector<T> = (state: AppState) => T;

export function useStore<T>(selector: Selector<T>): T {
  return selector(store.getState());
}

export function useDispatch() {
  return store.dispatch.bind(store);
}

export function useState<T>(initial: T): [T, (value: T) => void] {
  let state = initial;
  const subscribers = new Set<() => void>();

  return [
    state,
    (value: T) => {
      state = value;
      subscribers.forEach(fn => fn());
    }
  ];
}

export function useEffect(callback: () => (() => void) | void, _deps: unknown[]): void {
  let cleanupFn: (() => void) | undefined = undefined;
  
  const execute = () => {
    if (cleanupFn) cleanupFn();
    const result = callback();
    cleanupFn = typeof result === 'function' ? result : undefined;
  };
  
  execute();
  store.subscribe(() => execute());
}

export function useMemo<T>(factory: () => T, _deps: unknown[]): T {
  return factory();
}
