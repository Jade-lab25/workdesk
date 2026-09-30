-- ============================================================
-- SummaryDesk 多端删除同步：墓碑表
-- 2026-09
-- 背景：pushAll 用"云端有、本地无就删"的全量差集删除，而 PostgREST
--       单次最多返回 1000 行——数据超过 1000 行后，第 1000 行之后的记录
--       会被物理删除。改为与 FocusDesk 一致：删除只由显式墓碑驱动。
-- 可重复执行（幂等）。
-- ============================================================

CREATE TABLE IF NOT EXISTS sd_tombstones (
  id          TEXT        NOT NULL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name  TEXT        NOT NULL,   -- summary_ideas / summary_logs / summary_docs
  deleted_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, table_name, id)
);

CREATE INDEX IF NOT EXISTS idx_sd_tombstones_user ON sd_tombstones(user_id);

ALTER TABLE sd_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own sd_tombstones" ON sd_tombstones;
CREATE POLICY "Users can view their own sd_tombstones" ON sd_tombstones
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own sd_tombstones" ON sd_tombstones;
CREATE POLICY "Users can insert their own sd_tombstones" ON sd_tombstones
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own sd_tombstones" ON sd_tombstones;
CREATE POLICY "Users can update their own sd_tombstones" ON sd_tombstones
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own sd_tombstones" ON sd_tombstones;
CREATE POLICY "Users can delete their own sd_tombstones" ON sd_tombstones
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================================
-- 三张业务表补 updated_at（LWW 按真实编辑时间裁决）
-- + summary_logs.status（应用早已使用，DDL 漏提交）
-- + 存量 updated_at 复位
-- ============================================================

ALTER TABLE summary_ideas ADD COLUMN IF NOT EXISTS updated_at
  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS updated_at
  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS updated_at
  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS status
  TEXT NOT NULL DEFAULT 'done';

UPDATE summary_ideas SET updated_at = created_at
  WHERE updated_at IS DISTINCT FROM created_at;
UPDATE summary_logs SET updated_at = created_at
  WHERE updated_at IS DISTINCT FROM created_at;
UPDATE summary_docs SET updated_at = created_at
  WHERE updated_at IS DISTINCT FROM created_at;
