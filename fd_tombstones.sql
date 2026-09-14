-- ============================================================
-- FocusDesk 多端删除同步：墓碑表
-- 背景：删除标记原本只存在执行删除的浏览器 localStorage，
--       另一台浏览器不知道删除，会把本地残留记录重新 upsert 回云端（"诈尸"）。
-- 方案：删除标记上云，所有设备共享；30 天自动清理（由应用端定时 delete）。
-- 2026-09
-- ============================================================

CREATE TABLE IF NOT EXISTS fd_tombstones (
  id          TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name  TEXT        NOT NULL,           -- fd_goals / fd_tasks / fd_habits
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, table_name, id)
);

CREATE INDEX IF NOT EXISTS idx_fd_tombstones_user ON fd_tombstones(user_id);

ALTER TABLE fd_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own fd_tombstones" ON fd_tombstones;
CREATE POLICY "Users can view their own fd_tombstones" ON fd_tombstones
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own fd_tombstones" ON fd_tombstones;
CREATE POLICY "Users can insert their own fd_tombstones" ON fd_tombstones
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own fd_tombstones" ON fd_tombstones;
CREATE POLICY "Users can update their own fd_tombstones" ON fd_tombstones
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own fd_tombstones" ON fd_tombstones;
CREATE POLICY "Users can delete their own fd_tombstones" ON fd_tombstones
  FOR DELETE USING (auth.uid() = user_id);
