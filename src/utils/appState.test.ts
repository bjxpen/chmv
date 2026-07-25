import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppState } from './appState';

describe('AppState Management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should initialize with default values', () => {
    const state = new AppState();
    expect(state.theme).toBe('light');
    expect(state.fontSize).toBe(16);
    expect(state.containerWidth).toBe('800px');
  });

  it('should subscribe and notify of updates', () => {
    const state = new AppState();
    let count = 0;
    const unsub = state.subscribe(() => {
      count++;
    });

    state.updateState({ theme: 'dark' });
    expect(count).toBe(1);
    expect(state.theme).toBe('dark');

    unsub();
    state.updateState({ fontSize: 20 });
    expect(count).toBe(1); // unsubscribed
    expect(state.fontSize).toBe(20);
  });

  it('should manage recent files list', () => {
    const state = new AppState();
    state.registerRecentFile('hash1', 'Novel 1', 'chap1.html', 100, 50);

    expect(state.recentFiles.length).toBe(1);
    expect(state.recentFiles[0].hash).toBe('hash1');
    expect(state.recentFiles[0].lastChapterPath).toBe('chap1.html');

    // Add another file
    state.registerRecentFile('hash2', 'Novel 2', 'chap2.html', 200, 80);
    expect(state.recentFiles.length).toBe(2);
    expect(state.recentFiles[0].hash).toBe('hash2'); // newest is first
  });
});
