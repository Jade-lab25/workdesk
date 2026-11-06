import assert from 'node:assert/strict';
import {
  SHOP_PURCHASE_TITLE_PREFIX,
  isShopPurchaseLog,
  isActivityLog,
  normalizeAchievementLogs,
} from '../src/utils/achievementLogs.ts';

// 前缀里是全角冒号 U+FF1A（与 store/index.ts 的 `购买：${name}` 严格一致）
assert.equal(SHOP_PURCHASE_TITLE_PREFIX, '购买：', 'shop purchase title prefix must use full-width colon U+FF1A');

const shopPurchase = {
  id: 'log-shop',
  type: 'shop_purchase',
  title: '购买：新耳机',
  points: -234,
  createdAt: '2026-11-06T10:00:00.000Z',
  shopItemId: 'item-1',
};

// 历史脏数据：旧同步层把 shop_purchase 降级成了 commodity，且没有对应打卡记录
const dirtyCommodity = {
  id: 'log-dirty',
  type: 'commodity',
  title: '购买：吃一顿大餐',
  points: -300,
  createdAt: '2026-11-06T11:00:00.000Z',
};

// 真·打卡商品库兑换：同名前缀但同一次动作写了一条 projectName/createdAt 完全相同的打卡记录
const checkInBackedCommodity = {
  id: 'log-checkin',
  type: 'commodity',
  title: '购买：奶茶一杯',
  points: -15,
  createdAt: '2026-11-06T12:00:00.000Z',
};
const matchingCheckIn = {
  id: 'rec-1',
  projectName: '购买：奶茶一杯',
  createdAt: '2026-11-06T12:00:00.000Z',
};

const todoLog = { id: 'log-todo', type: 'todo', title: '写周报', points: 10, createdAt: '2026-11-06T08:00:00.000Z' };
const taskLog = { id: 'log-task', type: 'task', title: '任务库打卡', points: 20, createdAt: '2026-11-06T09:00:00.000Z' };
const plainCommodity = { id: 'log-commodity', type: 'commodity', title: '普通商品兑换', points: -5, createdAt: '2026-11-06T09:30:00.000Z' };

// ① 原生 shop_purchase：任何情况下都排除
assert.equal(isShopPurchaseLog(shopPurchase), true, 'native shop_purchase must be recognized without check-in context');
assert.equal(isActivityLog(shopPurchase), false, 'native shop_purchase must be excluded from calendar activity totals');

// ② 脏 commodity + 前缀、无匹配打卡：识别为商店购买并归一化
assert.equal(isShopPurchaseLog(dirtyCommodity, []), true, 'downgraded commodity with shop prefix and no check-in must be treated as shop purchase');
assert.equal(isActivityLog(dirtyCommodity, []), false, 'downgraded shop purchase must be excluded from calendar totals');
const normalizedOnce = normalizeAchievementLogs([dirtyCommodity], []);
assert.equal(normalizedOnce[0].type, 'shop_purchase', 'normalize must rewrite dirty commodity type to shop_purchase');
assert.equal(normalizedOnce[0].id, 'log-dirty', 'normalize must keep all other fields intact');
assert.equal(normalizedOnce[0].points, -300, 'normalize must not touch points');
assert.notStrictEqual(normalizedOnce[0], dirtyCommodity, 'normalize must return a new object instead of mutating input');
assert.equal(dirtyCommodity.type, 'commodity', 'normalize must not mutate the original log object');

// ③ 同前缀但有匹配打卡记录：是真·打卡商品库兑换，必须保留在日历口径内
assert.equal(
  isShopPurchaseLog(checkInBackedCommodity, [matchingCheckIn]),
  false,
  'prefixed commodity with a matching check-in record is a real check-in reward, not a shop purchase',
);
assert.equal(isActivityLog(checkInBackedCommodity, [matchingCheckIn]), true, 'check-in backed commodity must stay in calendar totals');
const normalizedWithCheckIn = normalizeAchievementLogs([checkInBackedCommodity], [matchingCheckIn]);
assert.equal(normalizedWithCheckIn[0].type, 'commodity', 'check-in backed commodity must not be rewritten');

// ④ todo / task / 无前缀普通 commodity：全部保留
for (const log of [todoLog, taskLog, plainCommodity]) {
  assert.equal(isShopPurchaseLog(log, []), false, `${log.type} log must not be classified as shop purchase`);
  assert.equal(isActivityLog(log, []), true, `${log.type} log must count in calendar totals`);
}

// 归一化对混合列表只改该改的行
const mixed = normalizeAchievementLogs(
  [shopPurchase, dirtyCommodity, checkInBackedCommodity, todoLog, taskLog, plainCommodity],
  [matchingCheckIn],
);
assert.deepEqual(
  mixed.map(l => [l.id, l.type]),
  [
    ['log-shop', 'shop_purchase'],
    ['log-dirty', 'shop_purchase'],
    ['log-checkin', 'commodity'],
    ['log-todo', 'todo'],
    ['log-task', 'task'],
    ['log-commodity', 'commodity'],
  ],
  'only the dirty downgraded row should be rewritten in a mixed list',
);

// undefined 入参兜底
assert.deepEqual(normalizeAchievementLogs(undefined), [], 'undefined logs should normalize to an empty list');

console.log('achievement log caliber tests passed');
