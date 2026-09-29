// ─── 自动同步设置 ────────────────────────────────────────────
// 存储用户对自动同步的偏好：开关 + 云端拉取频率。
// 纯本地偏好，与数据本身分开存储。

export type PullIntervalMinutes = 5 | 10 | 15;

export interface AutoSyncSettings {
  autoSyncEnabled: boolean;
  pullIntervalMinutes: PullIntervalMinutes;
}

const SETTINGS_KEY = 'work-status-app-sync-settings';

export const DEFAULT_SYNC_SETTINGS: AutoSyncSettings = {
  autoSyncEnabled: true,
  pullIntervalMinutes: 15,
};

const VALID_INTERVALS: PullIntervalMinutes[] = [5, 10, 15];

export function loadSyncSettings(): AutoSyncSettings {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        autoSyncEnabled: typeof parsed.autoSyncEnabled === 'boolean'
          ? parsed.autoSyncEnabled
          : DEFAULT_SYNC_SETTINGS.autoSyncEnabled,
        pullIntervalMinutes: VALID_INTERVALS.includes(parsed.pullIntervalMinutes)
          ? parsed.pullIntervalMinutes
          : DEFAULT_SYNC_SETTINGS.pullIntervalMinutes,
      };
    }
  } catch {}
  return { ...DEFAULT_SYNC_SETTINGS };
}

export function saveSyncSettings(settings: AutoSyncSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}
