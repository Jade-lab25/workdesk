-- ============================================================
-- SummaryDesk 工作日志：专注分段明细列
-- 2026-10
-- 背景：专注时长改为「分段累加」——被打断就先记一段，恢复后接着记，
--       总数自动累加。分段明细（[{m:分钟,t:时间}]）存这一列，
--       focus_actual 仍存总时长（派生值，兼容老逻辑与老数据）。
-- 前置：sd-focus-columns.sql 已跑（focus_goal / focus_actual 已存在）。
-- 可重复执行（幂等）。
-- ============================================================

ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS focus_sessions JSONB;

-- 验证：
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'summary_logs' AND column_name LIKE 'focus_%';
