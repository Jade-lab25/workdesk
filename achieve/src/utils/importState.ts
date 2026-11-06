import type { AchievementLog, AppState, Syncable, TimeRecord, Todo } from '../types';
// 显式 .ts 后缀：本文件被 tests/*.mjs 以 Node 原生 TS 擦除模式直接加载，
// Node ESM 不做无扩展名解析；tsc(allowImportingTsExtensions) 与 Vite 均兼容
import { normalizeAchievementLogs } from './achievementLogs.ts';

function markImportedDirty<T extends Syncable>(item: T): T {
  return {
    ...item,
    is_dirty: true,
    isDirty: true,
    synced_at: null,
    syncedAt: null,
  };
}

function markImportedArrayDirty<T extends Syncable>(items: T[] | undefined): T[] {
  return (items || []).map(markImportedDirty);
}

export function calculateAchievementTotals(logs: AchievementLog[]) {
  const totalEarned = logs
    .filter(log => log.type === 'task' || log.type === 'todo')
    .reduce((sum, log) => sum + (log.points || 0), 0);

  const totalSpent = logs
    .filter(log => log.type === 'commodity' || log.type === 'shop_purchase')
    .reduce((sum, log) => sum + Math.abs(log.points || 0), 0);

  return {
    totalEarned,
    totalSpent,
    totalAchievements: totalEarned - totalSpent,
  };
}

export function recalculateTodoTime(todos: Todo[], timeRecords: TimeRecord[]): Todo[] {
  return todos.map(todo => {
    const totalSeconds = timeRecords
      .filter(record => record.todoId === todo.id && record.endTime)
      .reduce((sum, record) => {
        if (record.startTimestamp && record.endTime) {
          const endTime = new Date(record.endTime).getTime();
          return sum + (endTime - record.startTimestamp) / 1000;
        }
        return sum;
      }, 0);

    return { ...todo, totalTime: totalSeconds };
  });
}

export function prepareImportedState(parsed: Partial<AppState>, initialState: AppState): AppState {
  const timeRecords = markImportedArrayDirty(parsed.timeRecords);
  const todos = recalculateTodoTime(markImportedArrayDirty(parsed.todos), timeRecords);
  const checkInRecords = markImportedArrayDirty(parsed.checkInRecords);
  // 导入备份里可能带着旧同步层降级的脏 commodity，先归一化再算总额
  const achievementLogs = normalizeAchievementLogs(
    markImportedArrayDirty(parsed.achievementLogs),
    checkInRecords,
  );
  const totals = calculateAchievementTotals(achievementLogs);

  return {
    ...initialState,
    ...parsed,
    todos,
    checkInProjects: markImportedArrayDirty(parsed.checkInProjects),
    checkInRecords,
    timeRecords,
    achievementLogs,
    inspirations: markImportedArrayDirty(parsed.inspirations),
    shopItems: markImportedArrayDirty(parsed.shopItems),
    totalAchievements: totals.totalAchievements,
    totalEarned: totals.totalEarned,
    totalSpent: totals.totalSpent,
    userStats: {},
  };
}
