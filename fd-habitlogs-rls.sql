-- ============================================================
-- FocusDesk：fd_habit_logs 补 UPDATE RLS 策略
-- 2026-09
-- 背景：新同步代码用稳定 id upsert 写打卡日志。upsert 在主键冲突时
--       走 UPDATE，而该表建表时只给了 SELECT/INSERT/DELETE 策略
--       （旧代码靠"删全量再重插"绕过），导致推送报 403：
--       new row violates row-level security policy (USING expression)
--       —— 每次打卡同步整轮失败，界面显示"云端连接失败/同步失败"。
-- 可重复执行（幂等）。
-- ============================================================

DROP POLICY IF EXISTS "Users can update their own fd_habit_logs" ON fd_habit_logs;
CREATE POLICY "Users can update their own fd_habit_logs" ON fd_habit_logs
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
