import { supabase } from './client';
import type { Todo, CheckInProject, CheckInRecord, TimeRecord, AchievementLog, Inspiration, UserStats } from './types';
import type { ShopItem } from './appTypes';
import { isItemDirty, markSynced } from './utils/syncState';
import { getSyncModeForTable } from './utils/syncModes';
import { splitInsertOnlyRecords } from './utils/insertOnlySync';
import { sanitizeForSync } from './utils/syncPayload';

function camelToSnake(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    result[snakeKey] = obj[key];
  }
  return result;
}

function snakeToCamel(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = obj[key];
  }
  return result;
}

/**
 * 通用表同步函数 - 批量 upsert 替代逐条操作
 * 性能提升: 1000条记录从 100秒 → 2秒
 * ✅ 修复：返回带服务器 synced_at 时间戳的记录，用于本地更新
 *
 * @param tableName 表名
 * @param userId 用户ID
 * @param localItems 本地数据
 * @param batchSize 每批大小，默认 100
 * @param syncAllItems true=全量同步, false=仅同步 is_dirty 的记录
 */
async function syncTable<T extends { id: string; synced_at?: string | null; is_dirty?: boolean }>(
  tableName: string,
  userId: string,
  localItems: T[],
  batchSize: number = 100,
  syncAllItems: boolean = false
): Promise<{ error: Error | null; syncedCount: number; syncedRecords: T[] }> {
  try {
    // 增量同步：仅同步标记为 dirty 或未同步过的记录
    const itemsToSync = syncAllItems
      ? localItems
      : localItems.filter(item => isItemDirty(item));

    if (itemsToSync.length === 0) {
      return { error: null, syncedCount: 0, syncedRecords: [] };
    }

    const allSynced: any[] = [];

    // 分批批量 upsert
    for (let i = 0; i < itemsToSync.length; i += batchSize) {
      const batch = itemsToSync.slice(i, i + batchSize);
      const now = new Date().toISOString();

      const records = batch.map(item => sanitizeForSync(item, userId, now, tableName));

      const { data, error } = await supabase
        .from(tableName)
        .upsert(records, { onConflict: 'id' })
        .select();

      if (error) throw error;
      if (data) {
        allSynced.push(...data);
      }
    }

    return {
      error: null,
      syncedCount: allSynced.length,
      syncedRecords: allSynced.map(snakeToCamel) as T[]
    };
  } catch (error) {
    return { error: error as Error, syncedCount: 0, syncedRecords: [] };
  }
}

/**
 * 批量插入记录 - 用于流水表（打卡记录、时间记录、成就流水）
 * 性能提升: N次请求 → 1次请求
 * ✅ 修复：返回带服务器 synced_at 时间戳的记录，用于本地更新
 */
async function batchInsert<T extends { id: string }>(
  tableName: string,
  userId: string,
  records: T[],
  batchSize: number = 500
): Promise<{ error: Error | null; insertedCount: number; insertedRecords: T[] }> {
  if (records.length === 0) {
    return { error: null, insertedCount: 0, insertedRecords: [] };
  }

  const allInserted: any[] = [];

  try {
    const now = new Date().toISOString();

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const ids = batch.map(record => record.id);
      const { data: existing, error: existingError } = await supabase
        .from(tableName)
        .select('*')
        .in('id', ids)
        .eq('user_id', userId);

      if (existingError) {
        throw existingError;
      }

      const { existingRecords, recordsToInsert } = splitInsertOnlyRecords(batch, existing);
      allInserted.push(...existingRecords);

      if (recordsToInsert.length === 0) {
        continue;
      }

      const recordsToInsertPayload = recordsToInsert.map(record => sanitizeForSync(record, userId, now, tableName));

      const { data, error } = await supabase
        .from(tableName)
        .insert(recordsToInsertPayload)
        .select();

      if (error) {
        throw error;
      } else if (data) {
        allInserted.push(...data);
      }
    }

    return {
      error: null,
      insertedCount: allInserted.length,
      insertedRecords: allInserted.map(snakeToCamel) as T[]
    };
  } catch (error) {
    return { error: error as Error, insertedCount: 0, insertedRecords: [] };
  }
}

/**
 * 批量删除云端的记录（用于本地删除后的同步）
 * 每次最多删除 500 条，避免 URL 过长
 */
export async function deleteBatch(
  tableName: string,
  ids: string[],
  batchSize: number = 500
): Promise<{ error: Error | null; deletedCount: number }> {
  try {
    let totalDeleted = 0;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const { error } = await supabase
        .from(tableName)
        .delete()
        .in('id', batch);
      if (error) throw error;
      totalDeleted += batch.length;
    }
    return { error: null, deletedCount: totalDeleted };
  } catch (error) {
    return { error: error as Error, deletedCount: 0 };
  }
}

export const auth = {
  signUp: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    return { data, error };
  },

  signIn: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  },

  getCurrentUser: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  },

  onAuthStateChange: (callback: (event: string, session: any) => void) => {
    return supabase.auth.onAuthStateChange(callback);
  }
};

export const todo = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('todos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },

  insert: async (todo: Omit<Todo, 'id' | 'synced_at'>) => {
    const { data, error } = await supabase
      .from('todos')
      .insert({ ...camelToSnake(todo), synced_at: new Date().toISOString() })
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  },

  update: async (id: string, updates: Partial<Todo>) => {
    const { data, error } = await supabase
      .from('todos')
      .update({ ...camelToSnake(updates), synced_at: new Date().toISOString() })
      .eq('id', id)
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('todos')
      .delete()
      .eq('id', id);
    return { error };
  },

  /**
   * 批量同步 todos - 使用通用 syncTable
   * ❌ 已移除：本地不存在即删除远程记录的危险逻辑
   * ✅ 只做增量 upsert，不自动删除任何数据
   * ✅ 返回带服务器 synced_at 时间戳的同步记录
   */
  sync: async (userId: string, localTodos: Todo[], syncAll: boolean = false) => {
    return syncTable<Todo>('todos', userId, localTodos, 100, syncAll);
  }
};

export const checkInProject = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('check_in_projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },

  insert: async (project: Omit<CheckInProject, 'id' | 'synced_at'>) => {
    const { data, error } = await supabase
      .from('check_in_projects')
      .insert({ ...camelToSnake(project), synced_at: new Date().toISOString() })
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  },

  update: async (id: string, updates: Partial<CheckInProject>) => {
    const { data, error } = await supabase
      .from('check_in_projects')
      .update({ ...camelToSnake(updates), synced_at: new Date().toISOString() })
      .eq('id', id)
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('check_in_projects')
      .delete()
      .eq('id', id);
    return { error };
  },

  /**
   * 批量同步打卡项目
   * ❌ 已移除：本地不存在即删除远程记录的危险逻辑
   * ✅ 返回带服务器 synced_at 时间戳的同步记录
   */
  sync: async (userId: string, localProjects: CheckInProject[], syncAll: boolean = false) => {
    return syncTable<CheckInProject>('check_in_projects', userId, localProjects, 100, syncAll);
  }
};

export const checkInRecord = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('check_in_records')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },

  insert: async (record: Omit<CheckInRecord, 'id' | 'synced_at'>) => {
    const { data, error } = await supabase
      .from('check_in_records')
      .insert({ ...camelToSnake(record), synced_at: new Date().toISOString() })
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  }
};

export const timeRecord = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('time_records')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },

  insert: async (record: Omit<TimeRecord, 'id' | 'synced_at'>) => {
    const { data, error } = await supabase
      .from('time_records')
      .insert({ ...camelToSnake(record), synced_at: new Date().toISOString() })
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  },

  update: async (id: string, updates: Partial<TimeRecord>) => {
    const { data, error } = await supabase
      .from('time_records')
      .update({ ...camelToSnake(updates), synced_at: new Date().toISOString() })
      .eq('id', id)
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('time_records')
      .delete()
      .eq('id', id);
    return { error };
  }
};

export const achievementLog = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('achievement_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },

  insert: async (log: Omit<AchievementLog, 'id' | 'synced_at'>) => {
    const { data, error } = await supabase
      .from('achievement_logs')
      .insert({ ...camelToSnake(log), synced_at: new Date().toISOString() })
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('achievement_logs')
      .delete()
      .eq('id', id);
    return { error };
  }
};

export const inspiration = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('inspirations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },

  insert: async (inspiration: Omit<Inspiration, 'id' | 'synced_at'>) => {
    const { data, error } = await supabase
      .from('inspirations')
      .insert({ ...camelToSnake(inspiration), synced_at: new Date().toISOString() })
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  },

  update: async (id: string, updates: Partial<Inspiration>) => {
    const { data, error } = await supabase
      .from('inspirations')
      .update({ ...camelToSnake(updates), synced_at: new Date().toISOString() })
      .eq('id', id)
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('inspirations')
      .delete()
      .eq('id', id);
    return { error };
  },

  /**
   * 批量同步灵感
   * ❌ 已移除：本地不存在即删除远程记录的危险逻辑
   * ✅ 返回带服务器 synced_at 时间戳的同步记录
   */
  sync: async (userId: string, localInspirations: Inspiration[], syncAll: boolean = false) => {
    return syncTable<Inspiration>('inspirations', userId, localInspirations, 100, syncAll);
  }
};

export const userStats = {
  get: async (userId: string) => {
    const { data, error } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', userId)
      .single();
    
    if (error && error.message.includes('No rows')) {
      return { data: null, error: null };
    }
    
    return { data: data ? snakeToCamel(data) : null, error };
  },

  upsert: async (userId: string, stats: Partial<UserStats>) => {
    const { data, error } = await supabase
      .from('user_stats')
      .upsert({
        id: userId,
        user_id: userId,
        ...camelToSnake(stats),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  }
};

/**
 * 用已同步的记录更新本地数据
 * ✅ 关键修复：将服务器返回的 synced_at 时间戳写入本地记录
 */
function updateLocalSyncStatus<T extends { id: string; synced_at?: string | null; syncedAt?: string | null; is_dirty?: boolean; isDirty?: boolean }>(
  localItems: T[],
  syncedItems: T[]
): T[] {
  const syncedMap = new Map(syncedItems.map(item => [item.id, item]));
  return localItems.map(item => {
    const syncedItem = syncedMap.get(item.id);
    if (syncedItem) {
      const syncedAt = (syncedItem as any).synced_at || (syncedItem as any).syncedAt;
      return markSynced(item, syncedAt) as T;
    }
    return item;
  });
}

export const syncAll = async (userId: string, data: {
  todos: any[];
  checkInProjects: any[];
  checkInRecords: any[];
  timeRecords: any[];
  achievementLogs: any[];
  inspirations: any[];
  shopItems: ShopItem[];
  userStats: Partial<UserStats>;
  fdGoals?: any[];
  fdTasks?: any[];
  fdHabits?: any[];
  fdHabitLogs?: any[];
  summaryDocs?: any[];
  summaryIdeas?: any[];
  summaryLogs?: any[];
}) => {
  const errors: string[] = [];
  const syncResults: Record<string, number> = {};

  // 收集所有成功同步的记录，用于后续更新本地状态
  let syncedTodos: any[] = [];
  let syncedProjects: any[] = [];
  let insertedCheckInRecords: any[] = [];
  let insertedTimeRecords: any[] = [];
  let insertedLogs: any[] = [];
  let syncedInspirations: any[] = [];
  let syncedShopItems: any[] = [];
  let syncedFdGoals: any[] = [];
  let syncedFdTasks: any[] = [];
  let syncedFdHabits: any[] = [];
  let syncedFdHabitLogs: any[] = [];
  let syncedSummaryDocs: any[] = [];
  let syncedSummaryIdeas: any[] = [];
  let syncedSummaryLogs: any[] = [];

  const fdGoals = data.fdGoals || [];
  const fdTasks = data.fdTasks || [];
  const fdHabits = data.fdHabits || [];
  const fdHabitLogs = data.fdHabitLogs || [];
  const summaryDocs = data.summaryDocs || [];
  const summaryIdeas = data.summaryIdeas || [];
  const summaryLogs = data.summaryLogs || [];

  try {
    // 1. 同步 todos - 批量 upsert
    if (data.todos.length > 0) {
      const { error, syncedCount, syncedRecords } = await todo.sync(userId, data.todos);
      if (error) errors.push(`Todos sync error: ${error.message}`);
      syncResults.todos = syncedCount;
      syncedTodos = syncedRecords;
    }

    // 2. 同步 checkInProjects - 批量 upsert
    if (data.checkInProjects.length > 0) {
      const { error, syncedCount, syncedRecords } = await checkInProject.sync(userId, data.checkInProjects);
      if (error) errors.push(`Project sync error: ${error.message}`);
      syncResults.checkInProjects = syncedCount;
      syncedProjects = syncedRecords;
    }

    // 3. 同步 checkInRecords - 批量插入（流水表只增不减）
    // 过滤已同步的记录（有 synced_at 且不是 dirty）
    const unsyncedCheckInRecords = data.checkInRecords.filter(r => isItemDirty(r));
    if (unsyncedCheckInRecords.length > 0) {
      const { error, insertedCount, insertedRecords } = await batchInsert('check_in_records', userId, unsyncedCheckInRecords, 500);
      if (error) errors.push(`Check-in record sync error: ${error.message}`);
      syncResults.checkInRecords = insertedCount;
      insertedCheckInRecords = insertedRecords;
    }

    // 4. 同步 timeRecords - 可变记录，开始后还会更新 endTime/note，必须 upsert
    const unsyncedTimeRecords = data.timeRecords.filter(r => isItemDirty(r));
    if (unsyncedTimeRecords.length > 0) {
      if (getSyncModeForTable('time_records') === 'upsert') {
        const { error, syncedCount, syncedRecords } = await syncTable('time_records', userId, unsyncedTimeRecords, 500, true);
        if (error) errors.push(`Time record sync error: ${error.message}`);
        syncResults.timeRecords = syncedCount;
        insertedTimeRecords = syncedRecords;
      } else {
        const { error, insertedCount, insertedRecords } = await batchInsert('time_records', userId, unsyncedTimeRecords, 500);
        if (error) errors.push(`Time record sync error: ${error.message}`);
        syncResults.timeRecords = insertedCount;
        insertedTimeRecords = insertedRecords;
      }
    }

    // 5. 同步 achievementLogs - 批量插入
    const unsyncedLogs = data.achievementLogs.filter(l => isItemDirty(l));
    if (unsyncedLogs.length > 0) {
      const { error, insertedCount, insertedRecords } = await batchInsert('achievement_logs', userId, unsyncedLogs, 500);
      if (error) errors.push(`Achievement log sync error: ${error.message}`);
      syncResults.achievementLogs = insertedCount;
      insertedLogs = insertedRecords;
    }

    // 6. 同步 inspirations - 批量 upsert
    if (data.inspirations.length > 0) {
      const { error, syncedCount, syncedRecords } = await inspiration.sync(userId, data.inspirations);
      if (error) errors.push(`Inspiration sync error: ${error.message}`);
      syncResults.inspirations = syncedCount;
      syncedInspirations = syncedRecords;
    }

    // 7. 同步 shopItems - 批量 upsert
    if (data.shopItems.length > 0) {
      const { error, syncedCount, syncedRecords } = await syncTable<ShopItem>('shop_items', userId, data.shopItems, 100);
      if (error) errors.push(`Shop items sync error: ${error.message}`);
      syncResults.shopItems = syncedCount;
      syncedShopItems = syncedRecords;
    }

    // 8. 同步 userStats
    if (Object.keys(data.userStats).length > 0) {
      const { error } = await userStats.upsert(userId, data.userStats);
      if (error) errors.push(`User stats sync error: ${error.message}`);
    }

    // 9. 同步 fd_goals（FocusDesk 目标，可变记录，upsert）
    if (fdGoals.length > 0) {
      const { error, syncedCount, syncedRecords } = await fdGoal.sync(userId, fdGoals);
      if (error) errors.push(`FdGoals sync error: ${error.message}`);
      syncResults.fdGoals = syncedCount;
      syncedFdGoals = syncedRecords;
    }

    // 10. 同步 fd_tasks（FocusDesk 任务/灵感，可变记录，upsert）
    if (fdTasks.length > 0) {
      const { error, syncedCount, syncedRecords } = await fdTask.sync(userId, fdTasks);
      if (error) errors.push(`FdTasks sync error: ${error.message}`);
      syncResults.fdTasks = syncedCount;
      syncedFdTasks = syncedRecords;
    }

    // 11. 同步 fd_habits（FocusDesk 习惯，upsert）
    if (fdHabits.length > 0) {
      const { error, syncedCount, syncedRecords } = await fdHabit.sync(userId, fdHabits);
      if (error) errors.push(`FdHabits sync error: ${error.message}`);
      syncResults.fdHabits = syncedCount;
      syncedFdHabits = syncedRecords;
    }

    // 12. 同步 fd_habit_logs（习惯打卡流水，upsert 幂等）
    if (fdHabitLogs.length > 0) {
      const { error, syncedCount, syncedRecords } = await fdHabitLog.sync(userId, fdHabitLogs);
      if (error) errors.push(`FdHabitLogs sync error: ${error.message}`);
      syncResults.fdHabitLogs = syncedCount;
      syncedFdHabitLogs = syncedRecords;
    }

    // 13. 同步 summary_docs（总结文档，upsert）
    if (summaryDocs.length > 0) {
      const { error, syncedCount, syncedRecords } = await summaryDoc.sync(userId, summaryDocs);
      if (error) errors.push(`SummaryDocs sync error: ${error.message}`);
      syncResults.summaryDocs = syncedCount;
      syncedSummaryDocs = syncedRecords;
    }

    // 14. 同步 summary_ideas（灵感库，upsert）
    if (summaryIdeas.length > 0) {
      const { error, syncedCount, syncedRecords } = await summaryIdea.sync(userId, summaryIdeas);
      if (error) errors.push(`SummaryIdeas sync error: ${error.message}`);
      syncResults.summaryIdeas = syncedCount;
      syncedSummaryIdeas = syncedRecords;
    }

    // 15. 同步 summary_logs（工作日志，upsert）
    if (summaryLogs.length > 0) {
      const { error, syncedCount, syncedRecords } = await summaryLog.sync(userId, summaryLogs);
      if (error) errors.push(`SummaryLogs sync error: ${error.message}`);
      syncResults.summaryLogs = syncedCount;
      syncedSummaryLogs = syncedRecords;
    }

  } catch (error) {
    errors.push(`Sync failed: ${(error as Error).message}`);
  }

  // ✅ 关键修复：返回同步后的数据，调用者可以用它更新本地状态
  return {
    success: errors.length === 0,
    errors,
    stats: syncResults,
    syncedData: {
      todos: updateLocalSyncStatus(data.todos, syncedTodos),
      checkInProjects: updateLocalSyncStatus(data.checkInProjects, syncedProjects),
      checkInRecords: updateLocalSyncStatus(data.checkInRecords, insertedCheckInRecords),
      timeRecords: updateLocalSyncStatus(data.timeRecords, insertedTimeRecords),
      achievementLogs: updateLocalSyncStatus(data.achievementLogs, insertedLogs),
      inspirations: updateLocalSyncStatus(data.inspirations, syncedInspirations),
      shopItems: updateLocalSyncStatus(data.shopItems, syncedShopItems),
      userStats: data.userStats,
      fdGoals: updateLocalSyncStatus(fdGoals, syncedFdGoals),
      fdTasks: updateLocalSyncStatus(fdTasks, syncedFdTasks),
      fdHabits: updateLocalSyncStatus(fdHabits, syncedFdHabits),
      fdHabitLogs: updateLocalSyncStatus(fdHabitLogs, syncedFdHabitLogs),
      summaryDocs: updateLocalSyncStatus(summaryDocs, syncedSummaryDocs),
      summaryIdeas: updateLocalSyncStatus(summaryIdeas, syncedSummaryIdeas),
      summaryLogs: updateLocalSyncStatus(summaryLogs, syncedSummaryLogs),
    }
  };
};

export const shopItem = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('shop_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },

  delete: async (id: string) => {
    const { error } = await supabase
      .from('shop_items')
      .delete()
      .eq('id', id);
    return { error };
  }
};

export const fetchAll = async (userId: string) => {
  const [
    { data: todos, error: todosError },
    { data: checkInProjects, error: projectsError },
    { data: checkInRecords, error: recordsError },
    { data: timeRecords, error: timeError },
    { data: achievementLogs, error: logsError },
    { data: inspirations, error: inspError },
    { data: shopItems, error: shopError },
    { data: userStatsData, error: statsError },
    { data: fdGoals, error: fdGoalsError },
    { data: fdTasks, error: fdTasksError },
    { data: fdHabits, error: fdHabitsError },
    { data: fdHabitLogs, error: fdHabitLogsError },
    { data: summaryDocs, error: summaryDocsError },
    { data: summaryIdeas, error: summaryIdeasError },
    { data: summaryLogs, error: summaryLogsError },
    { data: userSettingsData, error: settingsError }
  ] = await Promise.all([
    todo.getAll(userId),
    checkInProject.getAll(userId),
    checkInRecord.getAll(userId),
    timeRecord.getAll(userId),
    achievementLog.getAll(userId),
    inspiration.getAll(userId),
    shopItem.getAll(userId),
    userStats.get(userId),
    fdGoal.getAll(userId),
    fdTask.getAll(userId),
    fdHabit.getAll(userId),
    fdHabitLog.getAll(userId),
    summaryDoc.getAll(userId),
    summaryIdea.getAll(userId),
    summaryLog.getAll(userId),
    userSettings.get(userId)
  ]);

  const errors = [todosError, projectsError, recordsError, timeError, logsError, inspError, shopError, statsError, fdGoalsError, fdTasksError, fdHabitsError, fdHabitLogsError, summaryDocsError, summaryIdeasError, summaryLogsError, settingsError]
    .filter(e => e)
    .map(e => e!.message);

  return {
    data: {
      todos: todos || [],
      checkInProjects: checkInProjects || [],
      checkInRecords: checkInRecords || [],
      timeRecords: timeRecords || [],
      achievementLogs: achievementLogs || [],
      inspirations: inspirations || [],
      shopItems: shopItems || [],
      userStats: userStatsData || null,
      fdGoals: fdGoals || [],
      fdTasks: fdTasks || [],
      fdHabits: fdHabits || [],
      fdHabitLogs: fdHabitLogs || [],
      summaryDocs: summaryDocs || [],
      summaryIdeas: summaryIdeas || [],
      summaryLogs: summaryLogs || [],
      userSettings: userSettingsData || null
    },
    errors,
    success: errors.length === 0
  };
};

// ════════════════════════════════════════════
// FocusDesk（目标追踪）API
// ════════════════════════════════════════════

export const fdGoal = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('fd_goals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    return { data: data?.map(snakeToCamel), error };
  },
  sync: async (userId: string, localGoals: any[], syncAllItems: boolean = false) => {
    return syncTable<any>('fd_goals', userId, localGoals, 100, syncAllItems);
  }
};

export const fdTask = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('fd_tasks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    return { data: data?.map(snakeToCamel), error };
  },
  sync: async (userId: string, localTasks: any[], syncAllItems: boolean = false) => {
    return syncTable<any>('fd_tasks', userId, localTasks, 100, syncAllItems);
  }
};

export const fdHabit = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('fd_habits')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    return { data: data?.map(snakeToCamel), error };
  },
  sync: async (userId: string, localHabits: any[], syncAllItems: boolean = false) => {
    return syncTable<any>('fd_habits', userId, localHabits, 100, syncAllItems);
  }
};

export const fdHabitLog = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('fd_habit_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    return { data: data?.map(snakeToCamel), error };
  },
  sync: async (userId: string, localLogs: any[], syncAllItems: boolean = false) => {
    return syncTable<any>('fd_habit_logs', userId, localLogs, 100, syncAllItems);
  }
};

// ════════════════════════════════════════════
// Summary Desk（内容总结）API
// ════════════════════════════════════════════

export const summaryDoc = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('summary_docs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },
  sync: async (userId: string, localDocs: any[], syncAllItems: boolean = false) => {
    return syncTable<any>('summary_docs', userId, localDocs, 100, syncAllItems);
  }
};

export const summaryIdea = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('summary_ideas')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },
  sync: async (userId: string, localIdeas: any[], syncAllItems: boolean = false) => {
    return syncTable<any>('summary_ideas', userId, localIdeas, 100, syncAllItems);
  }
};

export const summaryLog = {
  getAll: async (userId: string) => {
    const { data, error } = await supabase
      .from('summary_logs')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false });
    return { data: data?.map(snakeToCamel), error };
  },
  sync: async (userId: string, localLogs: any[], syncAllItems: boolean = false) => {
    return syncTable<any>('summary_logs', userId, localLogs, 100, syncAllItems);
  }
};

export const userSettings = {
  get: async (userId: string) => {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.message.includes('No rows')) {
      return { data: null, error: null };
    }
    return { data: data ? snakeToCamel(data) : null, error };
  },

  upsert: async (userId: string, settings: { llmProvider?: string; llmApiKey?: string; llmModel?: string }) => {
    const { data, error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        ...camelToSnake(settings),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select();
    return { data: data?.[0] ? snakeToCamel(data[0]) : null, error };
  }
};
