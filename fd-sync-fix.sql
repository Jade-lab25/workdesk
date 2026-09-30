-- ============================================================
-- FocusDesk 同步修复：真实时间戳 + 服务器时钟 RPC
-- 2026-09
-- 背景：pushAll 每轮把 updated_at 刷成同步时刻，导致"最后同步的设备
--       （即使数据旧）在 LWW 合并中全面获胜"，多端轮流刷新时新编辑被覆盖丢失。
-- 配套：focusdesk/index.html 同步机制修复（编辑时写真实 updatedAt，上传不再伪造时间戳）。
-- 可重复执行（幂等）。
-- ============================================================

-- 1. 习惯两表补 updated_at（fd_goals/fd_tasks 建表时已有）
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS updated_at
  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE fd_habit_logs ADD COLUMN IF NOT EXISTS updated_at
  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- 2. 服务器时钟 RPC：客户端登录后对时，校正各设备时钟偏差（LWW 裁决依赖设备时间戳）
CREATE OR REPLACE FUNCTION server_now()
  RETURNS TIMESTAMP WITH TIME ZONE
  LANGUAGE SQL
  STABLE
  AS $$ SELECT now(); $$;

-- 3. 存量云端脏时间戳一次性复位
--    updated_at 此前被写成"最近同步时间"，全部失真。复位为真实的
--    创建/完成时间，部署新代码后 LWW 从诚实起点开始。
UPDATE fd_goals SET updated_at = created_at
  WHERE updated_at IS DISTINCT FROM created_at;

UPDATE fd_tasks SET updated_at = COALESCE(completed_at, created_at)
  WHERE updated_at IS DISTINCT FROM COALESCE(completed_at, created_at);

UPDATE fd_habits SET updated_at = created_at
  WHERE updated_at IS DISTINCT FROM created_at;

UPDATE fd_habit_logs SET updated_at = created_at
  WHERE updated_at IS DISTINCT FROM created_at;

-- 验证：
-- SELECT 'fd_tasks' t, count(*), max(updated_at) FROM fd_tasks
-- UNION ALL SELECT 'fd_habit_logs', count(*), max(updated_at) FROM fd_habit_logs;
