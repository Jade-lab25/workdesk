import type { AchievementLog, CheckInRecord } from '../types';

// 与 store/index.ts 购买流水标题前缀严格一致（全角冒号 U+FF1A，不是半角 :）
export const SHOP_PURCHASE_TITLE_PREFIX = '购买：';

type CheckInRef = Pick<CheckInRecord, 'projectName' | 'createdAt'>;

/**
 * 是否为成就商店购买（余额层面的消费，不进日历日/月/年汇总）。
 *
 * 两条判定路径：
 * 1. 原生 type='shop_purchase'；
 * 2. 历史脏数据：同步层曾把 shop_purchase 降级成 commodity（旧 DB 约束时代的
 *    workaround），靠「购买：」前缀识别，并用 checkInRecords 交叉验证防误伤——
 *    真·打卡商品库兑换在同一次动作里会写一条 projectName===title、createdAt
 *    相同的打卡记录，商店购买没有对应行。
 */
export function isShopPurchaseLog(
  log: AchievementLog,
  checkInRecords: CheckInRef[] = [],
): boolean {
  if (log.type === 'shop_purchase') return true;
  if (
    log.type === 'commodity'
    && typeof log.title === 'string'
    && log.title.startsWith(SHOP_PURCHASE_TITLE_PREFIX)
  ) {
    const hasMatchingCheckIn = checkInRecords.some(
      r => r.projectName === log.title && r.createdAt === log.createdAt,
    );
    return !hasMatchingCheckIn;
  }
  return false;
}

/** 日历活动口径：成就商店购买以外的流水都计入日/月/年汇总 */
export function isActivityLog(
  log: AchievementLog,
  checkInRecords: CheckInRef[] = [],
): boolean {
  return !isShopPurchaseLog(log, checkInRecords);
}

/**
 * 一次性内存归一化：把历史降级行的 type 纠正为 shop_purchase。
 * 不标脏、不主动上传（云端由 migrations/002 SQL 修复），让所有设备的显示
 * 立即收敛，不依赖同步 LWW 能否把云端修复行赢回本地（dirty 记录/时钟偏快
 * 两个盲区下 LWW 不一定生效）。
 */
export function normalizeAchievementLogs(
  logs: AchievementLog[] | undefined,
  checkInRecords: CheckInRef[] = [],
): AchievementLog[] {
  return (logs || []).map(log => (
    isShopPurchaseLog(log, checkInRecords) && log.type !== 'shop_purchase'
      ? { ...log, type: 'shop_purchase' as const }
      : log
  ));
}
