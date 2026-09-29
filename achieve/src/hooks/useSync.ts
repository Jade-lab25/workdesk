import { useState, useEffect, useCallback, useRef } from 'react';
import { syncAll, fetchAll, deleteBatch } from '../supabase/database';
import type { Todo, CheckInProject, CheckInRecord, TimeRecord, AchievementLog, Inspiration, Syncable, ShopItem } from '../types';
import type { UserStats } from '../supabase/types';
import { markSynced as markSyncedState, isItemDirty, getDeletedIds, clearDeletedIds } from '../utils/syncState';
import type { DeletedIdsCategory } from '../utils/syncState';
import { shouldDropSyncedLocalOnlyRecord } from '../utils/remoteDeletionSync';
import { loadSyncSettings, saveSyncSettings } from '../utils/syncSettings';
import type { AutoSyncSettings } from '../utils/syncSettings';

interface SyncState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSync: string | null;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  syncMessage: string;
}

interface SyncData {
  todos: Todo[];
  checkInProjects: CheckInProject[];
  checkInRecords: CheckInRecord[];
  timeRecords: TimeRecord[];
  achievementLogs: AchievementLog[];
  inspirations: Inspiration[];
  shopItems: ShopItem[];
  userStats: Partial<UserStats>;
}

const LOCAL_STORAGE_KEY = 'work-status-app-data';

// ─── 自动同步节奏常量 ────────────────────────────────────────
const PUSH_DEBOUNCE_MS = 30_000;            // 本地停手 30 秒后尝试自动上传
const MIN_PUSH_GAP_MS = 2 * 60_000;         // 两次自动上传最小间隔 2 分钟
// 连续失败后的退避重试间隔：1 / 2 / 5 分钟（5 分钟封顶）
const BACKOFF_STEPS_MS = [60_000, 2 * 60_000, 5 * 60_000];

type AutoSyncSource = 'push' | 'interval' | 'visible' | 'online' | 'retry';

type SyncOutcome =
  | { kind: 'success'; data: SyncData }
  | { kind: 'failed' }    // 真正的网络/接口失败 —— 计退避
  | { kind: 'skipped' };  // 离线/并发冲突跳过 —— 不计退避

/** 同步成功后清除 is_dirty 标记并设置 synced_at */
function markSynced<T extends Syncable>(item: T, syncedAt: string): T {
  return markSyncedState(item, syncedAt) as T;
}

/** 是否存在待上传的本地变更（脏记录或尚未推送到云端的删除） */
function hasPendingChanges(data: SyncData | null): boolean {
  if (!data) return false;
  const lists = [
    data.todos,
    data.checkInProjects,
    data.checkInRecords,
    data.timeRecords,
    data.achievementLogs,
    data.inspirations,
    data.shopItems,
  ];
  if (lists.some(list => list.some(item => isItemDirty(item)))) return true;
  const tombstones = getDeletedIds();
  return (Object.values(tombstones) as string[][]).some(ids => ids.length > 0);
}

interface SyncOptions {
  onDataFetched?: (data: any) => void;
}

export function useSync(userId: string | null, options?: SyncOptions) {
  const isSyncingRef = useRef<boolean>(false);
  const messageTimeoutRef = useRef<number | null>(null);

  // ─── 自动同步调度 refs ──────────────────────────────────
  const autoPushTimerRef = useRef<number | null>(null);   // 30s 防抖 + 2min 等待共用
  const lastAutoPushRef = useRef<number>(0);              // 上次自动上传实际开跑时间
  const lastAutoRunRef = useRef<number>(0);               // 上次自动同步实际开跑（visible 阈值用）
  const pullTimerRef = useRef<number | null>(null);       // 定时拉取 interval
  const backoffLevelRef = useRef<number>(0);              // 连续失败次数
  const retryTimerRef = useRef<number | null>(null);      // 退避重试 timer
  const lastFailureAtRef = useRef<number>(0);
  const inflightFetchRef = useRef<Promise<SyncData | null> | null>(null);

  const [syncState, setSyncState] = useState<SyncState>({
    isOnline: navigator.onLine,
    isSyncing: false,
    lastSync: null,
    syncStatus: 'idle',
    syncMessage: ''
  });

  const [syncSettings, setSyncSettings] = useState<AutoSyncSettings>(loadSyncSettings);

  // 镜像最新值到 ref，供稳定的 useCallback / 定时器闭包读取（不进依赖数组）
  const settingsRef = useRef(syncSettings);
  settingsRef.current = syncSettings;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const latestDataRef = useRef<SyncData | null>(null);

  const loadLocalData = useCallback((): SyncData => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      console.log('[Sync] Loading local data from key:', LOCAL_STORAGE_KEY);
      console.log('[Sync] Raw data exists:', !!saved);

      if (saved) {
        const parsed = JSON.parse(saved);
        console.log('[Sync] Loaded data:', {
          todos: parsed.todos?.length || 0,
          checkInProjects: parsed.checkInProjects?.length || 0,
          checkInRecords: parsed.checkInRecords?.length || 0,
          timeRecords: parsed.timeRecords?.length || 0,
          achievementLogs: parsed.achievementLogs?.length || 0,
          inspirations: parsed.inspirations?.length || 0,
          shopItems: parsed.shopItems?.length || 0,
          totalAchievements: parsed.totalAchievements || 0
        });

        const timeRecords: TimeRecord[] = parsed.timeRecords || [];
        const todos: Todo[] = parsed.todos || [];

        const recalculatedTodos = todos.map((todo: Todo) => {
          const todoRecords = timeRecords.filter((r: TimeRecord) => r.todoId === todo.id && r.endTime);
          const totalSeconds = todoRecords.reduce((sum: number, record: TimeRecord) => {
            if (record.startTimestamp && record.endTime) {
              const endTime = new Date(record.endTime).getTime();
              return sum + (endTime - record.startTimestamp) / 1000;
            }
            return sum;
          }, 0);
          return { ...todo, totalTime: totalSeconds };
        });

        return {
          todos: recalculatedTodos,
          checkInProjects: parsed.checkInProjects || [],
          checkInRecords: parsed.checkInRecords || [],
          timeRecords: parsed.timeRecords || [],
          achievementLogs: parsed.achievementLogs || [],
          inspirations: parsed.inspirations || [],
          shopItems: parsed.shopItems || [],
          userStats: {
            total_achievements: parsed.totalAchievements || 0,
            total_earned: parsed.totalEarned || 0,
            total_spent: parsed.totalSpent || 0
          }
        };
      }
    } catch (e) {
      console.error('[Sync] Failed to load local data:', e);
    }
    console.log('[Sync] Returning empty data');
    return {
      todos: [],
      checkInProjects: [],
      checkInRecords: [],
      timeRecords: [],
      achievementLogs: [],
      inspirations: [],
      shopItems: [],
      userStats: {}
    };
  }, []);

  const saveLocalData = useCallback((data: SyncData) => {
    try {
      // ✅ 兼容 AppState（顶层 totalAchievements）和 SyncData（嵌套 userStats）
      const appStateData = data as any;
      const saveData = {
        todos: data.todos,
        checkInProjects: data.checkInProjects,
        checkInRecords: data.checkInRecords,
        timeRecords: data.timeRecords,
        achievementLogs: data.achievementLogs,
        inspirations: data.inspirations,
        shopItems: data.shopItems,
        totalAchievements: appStateData.totalAchievements ?? data.userStats?.total_achievements ?? 0,
        totalEarned: appStateData.totalEarned ?? data.userStats?.total_earned ?? 0,
        totalSpent: appStateData.totalSpent ?? data.userStats?.total_spent ?? 0,
        userStats: data.userStats || {},
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(saveData));
    } catch (e) {
      console.error('Failed to save local data:', e);
    }
  }, []);

  // ─── 同步执行主体（手动 / 自动共用） ─────────────────────
  // silent=true（自动同步）：成功与进行中均静默，只更新 lastSync；失败仍弹红横幅。
  const executeSync = useCallback(async (userId: string, silent: boolean): Promise<SyncOutcome> => {
    if (!navigator.onLine) {
      if (!silent) {
        setSyncState(prev => ({ ...prev, syncStatus: 'idle', syncMessage: '当前离线，数据已保存到本地' }));
      }
      return { kind: 'skipped' };
    }

    // ✅ 并发守卫：防止多个同步请求同时执行
    if (isSyncingRef.current) {
      console.log('[Sync] Already syncing, skipping duplicate call');
      return { kind: 'skipped' };
    }

    isSyncingRef.current = true;
    setSyncState(prev => ({
      ...prev,
      isSyncing: true,
      syncStatus: 'syncing',
      syncMessage: silent ? '' : '正在同步数据...'
    }));

    const fail = (message: string): SyncOutcome => {
      isSyncingRef.current = false;
      setSyncState(prev => ({
        ...prev,
        isSyncing: false,
        syncStatus: 'error',
        syncMessage: message
      }));
      return { kind: 'failed' };
    };

    try {
      const syncStartTime = Date.now();
      const localData = loadLocalData();

      // ─── 处理本地删除 → 云端同步删除 ─────────────────────
      const CATEGORY_TO_TABLE: Record<DeletedIdsCategory, string> = {
        todos: 'todos',
        checkInProjects: 'check_in_projects',
        checkInRecords: 'check_in_records',
        timeRecords: 'time_records',
        achievementLogs: 'achievement_logs',
        inspirations: 'inspirations',
        shopItems: 'shop_items',
      };
      const deletedIds = getDeletedIds();
      let totalDeletedFromCloud = 0;
      for (const [category, ids] of Object.entries(deletedIds) as [DeletedIdsCategory, string[]][]) {
        if (ids.length > 0) {
          const tableName = CATEGORY_TO_TABLE[category];
          console.log(`[Sync] Deleting ${ids.length} ${category} from cloud (${tableName})`);
          const { error, deletedCount } = await deleteBatch(tableName, ids);
          if (error) {
            console.error(`[Sync] Failed to delete ${category} from cloud:`, error.message);
          } else {
            totalDeletedFromCloud += deletedCount;
            clearDeletedIds(category);
          }
        }
      }

      // 统计需要同步的记录数（增量同步）
      const dirtyCounts = {
        todos: localData.todos.filter(t => isItemDirty(t)).length,
        checkInProjects: localData.checkInProjects.filter(p => isItemDirty(p)).length,
        checkInRecords: localData.checkInRecords.filter(r => isItemDirty(r)).length,
        timeRecords: localData.timeRecords.filter(r => isItemDirty(r)).length,
        achievementLogs: localData.achievementLogs.filter(l => isItemDirty(l)).length,
        inspirations: localData.inspirations.filter(i => isItemDirty(i)).length,
        shopItems: localData.shopItems.filter(s => isItemDirty(s)).length,
      };
      const totalDirty = Object.values(dirtyCounts).reduce((a, b) => a + b, 0);
      console.log('[Sync] Incremental sync:', { totalDirty, ...dirtyCounts, deletedFromCloud: totalDeletedFromCloud });

      const syncedAtStr = new Date().toISOString();

      const finishSuccess = (data: SyncData, manualMessage: string): SyncOutcome => {
        isSyncingRef.current = false;
        // 成功证明链路恢复：清除退避状态与待执行的重试（手动成功也一样）
        backoffLevelRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        setSyncState(prev => ({
          ...prev,
          isSyncing: false,
          syncStatus: silent ? 'idle' : 'synced',
          syncMessage: silent ? '' : manualMessage,
          lastSync: syncedAtStr
        }));
        return { kind: 'success', data };
      };

      // 没有本地变更时，手动同步仍然需要拉取其他设备的新记录。
      if (totalDirty === 0 && totalDeletedFromCloud === 0) {
        console.log('[Sync] No dirty records or deletions, fetching remote changes');
        const { data: remoteData, success, errors } = await fetchAll(userId);

        if (!success) {
          return fail(`同步失败: ${errors.join(', ')}`);
        }

        const mergedData: SyncData = {
          todos: mergeData(localData.todos, remoteData.todos, syncedAtStr, false, true),
          checkInProjects: mergeData(localData.checkInProjects, remoteData.checkInProjects, syncedAtStr, false, true),
          checkInRecords: mergeData(localData.checkInRecords, remoteData.checkInRecords, syncedAtStr, false),
          timeRecords: mergeData(localData.timeRecords, remoteData.timeRecords, syncedAtStr, false),
          achievementLogs: mergeData(localData.achievementLogs, remoteData.achievementLogs, syncedAtStr, false),
          inspirations: mergeData(localData.inspirations, remoteData.inspirations, syncedAtStr, false, true),
          shopItems: mergeData(localData.shopItems, remoteData.shopItems, syncedAtStr, false, true),
          userStats: { ...localData.userStats, ...remoteData.userStats }
        };

        saveLocalData(mergedData);
        optionsRef.current?.onDataFetched?.(mergedData);

        const syncDuration = ((Date.now() - syncStartTime) / 1000).toFixed(1);
        return finishSuccess(mergedData, `已拉取云端最新数据，耗时 ${syncDuration} 秒`);
      }

      const { success, errors, syncedData } = await syncAll(userId, localData);
      console.log('[Sync] syncAll result:', { success, errors });

      if (!success) {
        return fail(`同步失败: ${errors.join(', ')}`);
      }

      // ✅ 关键修复：先从云端拉取所有数据（包括其他设备新增的记录）
      const { data: remoteData } = await fetchAll(userId);

      // ✅ 修复同步无限循环：
      //    syncedData 已经是 syncAll 返回的、清除了脏标记的数据
      //    现在只需要用 remoteData 补充本地没有的、其他设备新增的记录
      //    shouldMarkSynced = true，确保云端来的新记录有完整的同步字段
      const mergedData: SyncData = {
        todos: mergeData(syncedData.todos, remoteData.todos, syncedAtStr, true, true),
        checkInProjects: mergeData(syncedData.checkInProjects, remoteData.checkInProjects, syncedAtStr, true, true),
        checkInRecords: mergeData(syncedData.checkInRecords, remoteData.checkInRecords, syncedAtStr, true),
        timeRecords: mergeData(syncedData.timeRecords, remoteData.timeRecords, syncedAtStr, true),
        achievementLogs: mergeData(syncedData.achievementLogs, remoteData.achievementLogs, syncedAtStr, true),
        inspirations: mergeData(syncedData.inspirations, remoteData.inspirations, syncedAtStr, true, true),
        shopItems: mergeData(syncedData.shopItems, remoteData.shopItems, syncedAtStr, true, true),
        userStats: { ...syncedData.userStats, ...remoteData.userStats }
      };

      saveLocalData(mergedData);

      // ✅ 更新 React state，让从云端下载的其他设备数据能显示在 UI 中
      //    防止下次 syncOnChange 用旧 state 覆盖 localStorage
      optionsRef.current?.onDataFetched?.(mergedData);

      const syncDuration = ((Date.now() - syncStartTime) / 1000).toFixed(1);
      const parts: string[] = [];
      if (totalDirty > 0) parts.push(`共同步 ${totalDirty} 条记录`);
      if (totalDeletedFromCloud > 0) parts.push(`清理 ${totalDeletedFromCloud} 条已删除记录`);
      return finishSuccess(mergedData, `同步成功${parts.length > 0 ? '，' + parts.join('，') : ''}，耗时 ${syncDuration} 秒`);
    } catch (error) {
      console.error('[Sync] performSync error:', error);
      return fail(`同步失败: ${(error as Error).message}`);
    }
  }, [loadLocalData, saveLocalData]);

  // 手动同步入口：行为与旧版完全一致（非静默），返回值形状不变
  const performSync = useCallback((userId: string): Promise<SyncData | null> => {
    return executeSync(userId, false).then(outcome =>
      outcome.kind === 'success' ? outcome.data : null
    );
  }, [executeSync]);

  // ─── 自动同步统一入口：各来源过门禁后走静默执行 ──────────
  const runAutoSync = useCallback(async (source: AutoSyncSource) => {
    const uid = userIdRef.current;
    if (!uid || !settingsRef.current.autoSyncEnabled) return;
    if (!navigator.onLine) return;
    if (document.visibilityState !== 'visible') return; // 后台到期一律跳过
    if (isSyncingRef.current) return;                  // 复用并发守卫，本轮跳过不补

    const now = Date.now();

    // 退避门禁（retry / online 本身就是退避/恢复动作，不受限）
    if (source !== 'retry' && source !== 'online' && backoffLevelRef.current > 0) {
      const step = BACKOFF_STEPS_MS[Math.min(backoffLevelRef.current - 1, BACKOFF_STEPS_MS.length - 1)];
      if (now - lastFailureAtRef.current < step) return;
    }

    // 频率门禁（visible / interval）：有本地待上传变更时阈值 2 分钟，否则用拉取间隔
    if (source === 'visible' || source === 'interval') {
      const intervalMs = settingsRef.current.pullIntervalMinutes * 60_000;
      const threshold = hasPendingChanges(latestDataRef.current) ? MIN_PUSH_GAP_MS : intervalMs;
      if (now - lastAutoRunRef.current < threshold) return;
    }

    lastAutoRunRef.current = Date.now();
    if (hasPendingChanges(latestDataRef.current)) lastAutoPushRef.current = Date.now();

    const outcome = await executeSync(uid, true);

    if (outcome.kind === 'success') {
      latestDataRef.current = outcome.data; // 下次判断基于已清脏的数据
    } else if (outcome.kind === 'failed') {
      backoffLevelRef.current += 1;
      lastFailureAtRef.current = Date.now();
      const delay = BACKOFF_STEPS_MS[Math.min(backoffLevelRef.current - 1, BACKOFF_STEPS_MS.length - 1)];
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => void runAutoSync('retry'), delay);
    }
    // skipped：什么都不做
  }, [executeSync]);

  const fetchFromCloud = useCallback(async (userId: string): Promise<SyncData | null> => {
    if (!navigator.onLine) {
      console.log('Offline, returning local data');
      return loadLocalData();
    }
    // 与 performSync / 自动同步去重：同步进行中直接跳过（其结尾已含全量拉取）
    if (isSyncingRef.current) return null;
    if (inflightFetchRef.current) return inflightFetchRef.current;

    const doFetch = async (): Promise<SyncData | null> => {
      try {
        const { data, success } = await fetchAll(userId);
        if (success && data) {
          // 先加载本地数据，保留 is_dirty 的记录
          const localData = loadLocalData();
          const timeRecords: TimeRecord[] = data.timeRecords || [];
          const todos: Todo[] = data.todos || [];

          const recalculatedTodos = todos.map((todo: Todo) => {
            const todoRecords = timeRecords.filter((r: TimeRecord) => r.todoId === todo.id && r.endTime);
            const totalSeconds = todoRecords.reduce((sum: number, record: TimeRecord) => {
              if (record.startTimestamp && record.endTime) {
                const endTime = new Date(record.endTime).getTime();
                return sum + (endTime - record.startTimestamp) / 1000;
              }
              return sum;
            }, 0);
            return { ...todo, totalTime: totalSeconds };
          });

          // ✅ 合并本地和云端数据。
          // ⚠️ fetchFromCloud 只下载不上传，所以 shouldMarkSynced=false
          //    防止本地未上传的 dirty 记录被错误标记为已同步
          const syncedAt = new Date().toISOString();
          const mergedData: SyncData = {
            todos: mergeData(localData.todos, recalculatedTodos, syncedAt, false, true),
            checkInProjects: mergeData(localData.checkInProjects, data.checkInProjects, syncedAt, false, true),
            checkInRecords: mergeData(localData.checkInRecords, data.checkInRecords, syncedAt, false),
            timeRecords: mergeData(localData.timeRecords, data.timeRecords, syncedAt, false),
            achievementLogs: mergeData(localData.achievementLogs, data.achievementLogs, syncedAt, false),
            inspirations: mergeData(localData.inspirations, data.inspirations, syncedAt, false, true),
            shopItems: mergeData(localData.shopItems, data.shopItems, syncedAt, false, true),
            userStats: { ...localData.userStats, ...data.userStats }
          };

          // 保存到 localStorage
          saveLocalData(mergedData);
          latestDataRef.current = mergedData;

          // ✅ 回调更新 React state（关键修复）
          optionsRef.current?.onDataFetched?.(mergedData);

          return mergedData;
        }
      } catch (error) {
        console.error('[Sync] fetchFromCloud error:', error);
      }

      return loadLocalData();
    };

    inflightFetchRef.current = doFetch().finally(() => {
      inflightFetchRef.current = null;
    });
    return inflightFetchRef.current;
  }, [loadLocalData, saveLocalData]);

  // ✅ 手动同步模式：只保存本地数据，不自动同步
  // 用户需要手动点击同步按钮才能上传/下载数据
  const syncOnChange = useCallback((_userId: string | null, data: SyncData) => {
    saveLocalData(data);
    latestDataRef.current = data;

    if (!_userId || !settingsRef.current.autoSyncEnabled) return;
    if (!hasPendingChanges(data)) return;

    // 30 秒防抖：每次变更重置
    if (autoPushTimerRef.current) clearTimeout(autoPushTimerRef.current);
    autoPushTimerRef.current = window.setTimeout(() => {
      autoPushTimerRef.current = null;
      const waitForGap = MIN_PUSH_GAP_MS - (Date.now() - lastAutoPushRef.current);
      const launch = () => {
        autoPushTimerRef.current = null;
        lastAutoPushRef.current = Date.now();
        void runAutoSync('push');
      };
      // 距上次自动上传不足 2 分钟：继续等待差额，满 2 分钟再上传
      if (waitForGap > 0) {
        autoPushTimerRef.current = window.setTimeout(launch, waitForGap);
      } else {
        launch();
      }
    }, PUSH_DEBOUNCE_MS);
  }, [saveLocalData, runAutoSync]);

  // ─── 设置持久化 ─────────────────────────────────────────
  useEffect(() => {
    saveSyncSettings(syncSettings);
  }, [syncSettings]);

  const updateSyncSettings = useCallback((patch: Partial<AutoSyncSettings>) => {
    setSyncSettings(prev => ({ ...prev, ...patch }));
  }, []);

  // ✅ 同步消息 5 秒后自动消失
  useEffect(() => {
    if (syncState.syncStatus === 'synced' || syncState.syncStatus === 'error') {
      if (messageTimeoutRef.current) {
        clearTimeout(messageTimeoutRef.current);
      }
      messageTimeoutRef.current = window.setTimeout(() => {
        setSyncState(prev => ({ ...prev, syncMessage: '', syncStatus: 'idle' }));
      }, 5000);
    }
    return () => {
      if (messageTimeoutRef.current) {
        clearTimeout(messageTimeoutRef.current);
      }
    };
  }, [syncState.syncStatus, syncState.syncMessage]);

  // ─── 定时拉取 + 标签重新可见 ─────────────────────────────
  useEffect(() => {
    if (!userId || !syncSettings.autoSyncEnabled) return;

    const intervalMs = syncSettings.pullIntervalMinutes * 60_000;
    pullTimerRef.current = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return; // 后台跳过本轮
      void runAutoSync('interval');
    }, intervalMs);

    const handleVisible = () => void runAutoSync('visible');
    document.addEventListener('visibilitychange', handleVisible);

    return () => {
      if (pullTimerRef.current) {
        clearInterval(pullTimerRef.current);
        pullTimerRef.current = null;
      }
      // 关闭开关/改频率时，已挂起的上传防抖也要一并停掉
      if (autoPushTimerRef.current) {
        clearTimeout(autoPushTimerRef.current);
        autoPushTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [userId, syncSettings.autoSyncEnabled, syncSettings.pullIntervalMinutes, runAutoSync]);

  // ✅ 在线/离线状态监听
  useEffect(() => {
    const handleOnline = () => {
      setSyncState(prev => ({ ...prev, isOnline: true }));
      if (userId && settingsRef.current.autoSyncEnabled) {
        // 断网恢复视为新开始：清退避，立即静默同步一次
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        backoffLevelRef.current = 0;
        void runAutoSync('online');
      }
    };

    const handleOffline = () => {
      setSyncState(prev => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [userId, runAutoSync]);

  // ─── 退出登录：立即停止全部自动调度 ─────────────────────
  useEffect(() => {
    if (userId === null) {
      [autoPushTimerRef, retryTimerRef].forEach(ref => {
        if (ref.current) {
          clearTimeout(ref.current);
          ref.current = null;
        }
      });
      if (pullTimerRef.current) {
        clearInterval(pullTimerRef.current);
        pullTimerRef.current = null;
      }
      backoffLevelRef.current = 0;
    }
  }, [userId]);

  // ─── 组件卸载：清理全部定时器 ───────────────────────────
  useEffect(() => () => {
    [autoPushTimerRef, retryTimerRef, messageTimeoutRef].forEach(ref => {
      if (ref.current) clearTimeout(ref.current);
    });
    if (pullTimerRef.current) clearInterval(pullTimerRef.current);
  }, []);

  return {
    syncState,
    loadLocalData,
    saveLocalData,
    performSync,
    fetchFromCloud,
    syncOnChange,
    autoSyncSettings: syncSettings,
    updateSyncSettings,
  };
}

function mergeData<T extends { id: string; synced_at?: string | null; syncedAt?: string | null; is_dirty?: boolean; isDirty?: boolean; created_at?: string; createdAt?: string }>(
  local: T[],
  remote: T[],
  syncedAtStr: string,
  shouldMarkSynced: boolean = true,
  dropSyncedLocalOnly: boolean = false
): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();

  // is_dirty 是纯客户端概念：云端返回的该列值无意义。
  // 历史上旧版本曾把 is_dirty=true 写进云表，之后 upsert 不再带这列、值永久残留，
  // 导致 LWW 平局时云端脏值"获胜"，记录永远清不掉。合并前一律剥除云端脏标记。
  remote = remote.map(item =>
    item.is_dirty || item.isDirty ? { ...item, is_dirty: false, isDirty: false } : item
  );

  // 字段兼容函数：同时支持 snake_case 和 camelCase
  const getSyncedAt = (item: T): number => {
    const val = (item as any).synced_at || (item as any).syncedAt;
    return val ? new Date(val).getTime() : 0;
  };
  const isDirty = (item: T): boolean => isItemDirty(item);

  // ✅ 确保记录同时拥有 synced_at 和 syncedAt，避免 isItemDirty 误判
  //    云端数据经 snakeToCamel 转换后只有 syncedAt，缺少 synced_at
  const normalizeSyncFields = (item: T): T => {
    const a = item as any;
    if (a.syncedAt && !a.synced_at) {
      return { ...item, synced_at: a.syncedAt };
    }
    if (a.synced_at && !a.syncedAt) {
      return { ...item, syncedAt: a.synced_at };
    }
    return item;
  };

  // ✅ 云端优先：确保云端已同步的最新数据优先被采用
  [...remote, ...local].forEach(item => {
    if (seen.has(item.id)) return;
    seen.add(item.id);

    const remoteItem = remote.find(r => r.id === item.id);
    const localItem = local.find(l => l.id === item.id);

    if (remoteItem && localItem) {
      // 如果本地有未同步的更改，保留本地
      if (isDirty(localItem)) {
        // ✅ 关键修复：
        //    performSync: shouldMarkSynced=true，表示 syncAll 已上传成功，必须清除脏标记（防止无限循环！）
        //    fetchFromCloud: shouldMarkSynced=false，只下载不上传，保留本地脏标记避免误判
        merged.push(shouldMarkSynced ? markSynced(localItem, syncedAtStr) : localItem);
      } else {
        // 否则取更新的版本（比较 synced_at/syncedAt 时间）
        const remoteTime = getSyncedAt(remoteItem);
        const localTime = getSyncedAt(localItem);
        const winner = localTime > remoteTime ? localItem : remoteItem;
        // ✅ 确保 winner 同时拥有两个字段
        merged.push(normalizeSyncFields(winner));
      }
    } else if (remoteItem) {
      // ✅ 只有云端的记录（其他设备新增的！），直接用并补充缺失的同步字段
      //    这确保了多端设备新增的数据能正确同步到本地
      merged.push(normalizeSyncFields(remoteItem));
    } else if (localItem) {
      if (shouldDropSyncedLocalOnlyRecord(localItem, dropSyncedLocalOnly)) {
        return;
      }
      // 只有本地的新记录
      // ✅ performSync 中调用 mergeData 时 shouldMarkSynced=true 表示已上传成功
      //    fetchFromCloud 中调用时 shouldMarkSynced=false 表示还没上传，保留脏标记
      merged.push(shouldMarkSynced ? markSynced(localItem, syncedAtStr) : localItem);
    }
  });

  // ✅ 过滤掉本地已删除的记录（防止在云端删除完成前被复活）
  const allDeletedIds = new Set<string>();
  try {
    const deletedIds = getDeletedIds();
    for (const ids of Object.values(deletedIds)) {
      for (const id of ids as string[]) {
        allDeletedIds.add(id);
      }
    }
  } catch {}

  const filtered = allDeletedIds.size > 0
    ? merged.filter(item => !allDeletedIds.has(item.id))
    : merged;

  // 按创建时间倒序排列（确保最新的记录在前面）
  const getCreatedAt = (item: T): number => {
    const val = (item as any).createdAt || (item as any).created_at;
    return val ? new Date(val).getTime() : 0;
  };
  return filtered.sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
}
