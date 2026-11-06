-- ============================================================================
-- Migration 002：修复被旧同步层降级的成就商店购买流水
-- ----------------------------------------------------------------------------
-- 背景：旧版客户端的上传层会把 type='shop_purchase' 强制改写成 'commodity'
--       并剥掉 shop_item_id，导致成就商店购买被日历日/月/年汇总误算，
--       出现当天/当月大额负数。新版客户端已删除该降级逻辑，本脚本修复存量。
--
-- 执行位置：Supabase Dashboard → SQL Editor（以 service role 执行，绕过 RLS，
--           能看到所有用户的行；客户端自己的 REST 调用受 RLS 限制，做不了）
--
-- 重要注意：
--   1. 标题前缀里的冒号是【全角冒号 U+FF1A】「购买：」，不要替换成半角「:」，
--      否则 LIKE 一行都匹配不到。
--   2. 本脚本幂等，可安全重复执行：已修复的行 type 已不是 commodity，
--      重跑影响 0 行。
--   3. 不回填 shop_item_id：历史行的该字段在降级时已永久丢失，当前应用
--      没有任何功能消费这个字段，无需补。
--   4. 多用户库默认修复所有用户；只想修单个用户时，把两处标注的
--     「AND l.user_id = '...'」注释打开。
--   5. 执行节奏：先发新版客户端 → 再跑本脚本 → 手机也升级新版后，重跑一次
--      本脚本收尾（旧客户端在窗口期仍可能插入新的降级行，但它只有 insert
--      权限，不会把已修复的行改回去）。
-- ============================================================================

-- ① 列前置校验：两列若不存在则补齐（已存在会自动跳过，不报错）
ALTER TABLE achievement_logs
  ADD COLUMN IF NOT EXISTS shop_item_id TEXT;

ALTER TABLE shop_items
  ADD COLUMN IF NOT EXISTS purchased_at TIMESTAMP WITH TIME ZONE;

-- 可选：确认 type 约束已允许 shop_purchase（001 迁移应已执行；结果里应包含 shop_purchase）
-- SELECT pg_get_constraintdef(oid) AS constraint_definition
-- FROM pg_constraint
-- WHERE conrelid = 'achievement_logs'::regclass
--   AND conname = 'achievement_logs_type_check';

BEGIN;

-- ② 修复前预览：先看将被改写的行（同一事务内的快照，结果与下一步 UPDATE 完全一致）
SELECT l.id, l.user_id, l.title, l.points, l.created_at
FROM achievement_logs l
WHERE l.type = 'commodity'
  AND l.title LIKE '购买：%'  -- 全角冒号 U+FF1A
  AND NOT EXISTS (
    SELECT 1
    FROM check_in_records c
    WHERE c.user_id = l.user_id
      AND c.project_name = l.title
      AND c.created_at = l.created_at
  )
  -- 单用户限定（可选）：AND l.user_id = '你的-user-uuid'
ORDER BY l.created_at;

-- ③ 正式修复：
--    判定口径与客户端 src/utils/achievementLogs.ts 完全一致——
--    commodity + 「购买：」前缀，且不存在同 user、同 project_name、
--    同 created_at 的打卡记录（真·打卡商品库兑换在同一次动作里会写
--    一条完全对应的 check_in_records，商店购买没有）。
UPDATE achievement_logs l
SET type = 'shop_purchase',
    synced_at = NOW()
WHERE l.type = 'commodity'
  AND l.title LIKE '购买：%'  -- 全角冒号 U+FF1A
  AND NOT EXISTS (
    SELECT 1
    FROM check_in_records c
    WHERE c.user_id = l.user_id
      AND c.project_name = l.title
      AND c.created_at = l.created_at
  );
  -- 单用户限定（可选）：AND l.user_id = '你的-user-uuid'

-- ④ 校验一：剩余待修复行数必须为 0
SELECT COUNT(*) AS remaining_downgraded_should_be_zero
FROM achievement_logs l
WHERE l.type = 'commodity'
  AND l.title LIKE '购买：%'
  AND NOT EXISTS (
    SELECT 1
    FROM check_in_records c
    WHERE c.user_id = l.user_id
      AND c.project_name = l.title
      AND c.created_at = l.created_at
  );

-- ⑤ 校验二：修复后的类型分布（shop_purchase 应大于 0，数字与预览行数对得上）
SELECT type, COUNT(*) AS row_count
FROM achievement_logs
GROUP BY type
ORDER BY type;

COMMIT;

-- ============================================================================
-- 回滚方法（一般不需要；仅当发现误判时）：
-- BEGIN;
-- UPDATE achievement_logs
-- SET type = 'commodity', synced_at = NOW()
-- WHERE type = 'shop_purchase' AND title LIKE '购买：%';
-- COMMIT;
-- 注意：回滚会让日历汇总重新把这些行算进去。
-- ============================================================================
