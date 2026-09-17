-- ============================================================
-- FocusDesk 重复任务：fd_tasks 周期字段
-- rec_rule   重复规则：'' 不重复 / daily / weekly / monthly / yearly
-- series_id  系列 ID（模板与自动生成的实例共享；模板 = 系列第 0 期）
-- series_seq 期数（从 0 开始；与 series_id 共同决定确定性实例 ID，防多端重复生成）
-- rec_skip   跳过名单（JSON 数组，存模板上，如 [2] 表示第 2 期被用户删除/不做）
-- 2026-09
-- ============================================================

ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS rec_rule   TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS series_id  TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS series_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS rec_skip   TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_fd_tasks_series ON fd_tasks(series_id);
