-- ============================================================
-- FocusDesk 重复任务：fd_tasks 增加周期字段
-- rec_rule   重复规则：'' 不重复 / daily / weekly / monthly / yearly
-- series_id  系列 ID（同一组自动生成的任务共享；首期 = 模板）
-- series_seq 期数（从 0 开始；与 series_id 共同决定确定性实例 ID，防多端重复生成）
-- 2026-09
-- ============================================================

ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS rec_rule   TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS series_id  TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS series_seq INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_fd_tasks_series ON fd_tasks(series_id);
