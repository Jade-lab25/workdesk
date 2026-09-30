-- ============================================================
-- SummaryDesk 工作日志：专注目标 / 实际专注时长 两列
-- 2026-09
-- 背景：工作日志新增「专注目标」功能——写日志时可定最小专注分钟数，
--       完成后卡片回填实际分钟数，AI 总结加【专注状态】一节。
--       本地日志存在 data JSON 里（focusGoal/focusActual），
--       云端 summary_logs 补对应两列，由转换器读写。
-- 可重复执行（幂等）。
-- ============================================================

ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS focus_goal
  INTEGER NOT NULL DEFAULT 0;          -- 目标专注分钟数；0 = 本条没定目标

ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS focus_actual
  INTEGER;                             -- 实际专注分钟数；未回填可空

-- 验证：
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'summary_logs' AND column_name LIKE 'focus_%';
