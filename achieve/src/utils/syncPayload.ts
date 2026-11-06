function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    result[snakeKey] = obj[key];
  }
  return result;
}

export function sanitizeForSync<T extends Record<string, unknown>>(
  record: T,
  userId: string,
  syncedAt: string,
  tableName?: string,
) {
  const { is_dirty, isDirty, synced_at, syncedAt: _syncedAt, ...rest } = record;
  const payload = camelToSnake(rest);

  // shop_items 表没有 icon 列（见 supabase-migrations.sql），上传前剥除；
  // purchased_at 列已存在，正常同步。
  if (tableName === 'shop_items') {
    delete payload.icon;
  }
  // achievement_logs 的四种 type（todo/task/commodity/shop_purchase）DB 约束
  // 均已允许，shop_item_id 列也已存在，原样上传，不再做降级改写——
  // 旧改写会把成就商店购买污染成 commodity，导致日历统计排除规则失效。

  return {
    ...payload,
    user_id: userId,
    synced_at: syncedAt,
  };
}
