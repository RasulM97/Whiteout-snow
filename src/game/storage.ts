/**
 * storage.ts — localStorage persistence (high score/progress/settings).
 * Browser-local storage: doesn't sync across devices, and clearing browser data loses it — state this to the user on delivery.
 */

const PREFIX = "whiteout.";

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): boolean {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true;
    } catch {
      return false; // storage full, blocked or private: gameplay continues without persistence
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      // same as set(): storage unavailable is not a game error
    }
  },
};

export const highScore = {
  get: () => storage.get<number>("highScore", 0),
  set: (v: number) => storage.set("highScore", v),
};
