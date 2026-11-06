import assert from 'node:assert/strict';
import { markDirty, markSynced, isItemDirty } from '../src/utils/syncState.ts';
import { sanitizeForSync } from '../src/utils/syncPayload.ts';

const dirtyItem = markDirty({ id: '1', title: 'demo' });
assert.equal(isItemDirty(dirtyItem), true, 'new item should be treated as dirty');

const syncedItem = markSynced(dirtyItem, '2026-07-01T00:00:00.000Z');
assert.equal(isItemDirty(syncedItem), false, 'synced item should not be treated as dirty');
assert.equal(syncedItem.is_dirty, false, 'snake_case dirty flag should be cleared');
assert.equal(syncedItem.isDirty, false, 'camelCase dirty flag should be cleared');
assert.equal(syncedItem.synced_at, '2026-07-01T00:00:00.000Z', 'snake_case synced timestamp should be set');
assert.equal(syncedItem.syncedAt, '2026-07-01T00:00:00.000Z', 'camelCase synced timestamp should be set');

const sanitized = sanitizeForSync({ id: '2', is_dirty: true, isDirty: true, synced_at: null, syncedAt: null }, 'user-1', '2026-07-01T00:00:00.000Z');
assert.equal(sanitized.isDirty, undefined, 'sync payload should not include isDirty');
assert.equal(sanitized.is_dirty, undefined, 'sync payload should not include is_dirty');
assert.equal(sanitized.user_id, 'user-1', 'sync payload should include user id');
assert.equal(sanitized.synced_at, '2026-07-01T00:00:00.000Z', 'sync payload should include synced timestamp');

const shopPayload = sanitizeForSync({
  id: 'shop-1',
  name: 'Coffee',
  isPurchased: true,
  purchasedAt: '2026-07-02T08:00:00.000Z',
  icon: 'coffee',
}, 'user-1', '2026-07-02T08:01:00.000Z', 'shop_items');
assert.equal(shopPayload.is_purchased, true, 'camelCase fields should be converted to snake_case');
assert.equal(shopPayload.purchased_at, '2026-07-02T08:00:00.000Z', 'purchased_at column now exists and must be kept in sync payloads');
assert.equal(shopPayload.icon, undefined, 'shop_items has no icon column, icon must still be stripped');

const purchaseLogPayload = sanitizeForSync({
  id: 'log-1',
  type: 'shop_purchase',
  title: 'Buy coffee',
  points: -10,
  createdAt: '2026-07-02T08:00:00.000Z',
  shopItemId: 'shop-1',
}, 'user-1', '2026-07-02T08:01:00.000Z', 'achievement_logs');
assert.equal(purchaseLogPayload.type, 'shop_purchase', 'shop purchases must keep their own type so calendar filters can exclude them');
assert.equal(purchaseLogPayload.shop_item_id, 'shop-1', 'shop_item_id column now exists and must be kept in sync payloads');
assert.equal(purchaseLogPayload.created_at, '2026-07-02T08:00:00.000Z', 'createdAt should still be synced');

const todoLogPayload = sanitizeForSync({
  id: 'log-2',
  type: 'todo',
  title: 'Finish report',
  points: 5,
  createdAt: '2026-07-02T09:00:00.000Z',
}, 'user-1', '2026-07-02T09:01:00.000Z', 'achievement_logs');
assert.equal(todoLogPayload.type, 'todo', 'todo logs must no longer be rewritten into task');

console.log('syncState regression tests passed');
