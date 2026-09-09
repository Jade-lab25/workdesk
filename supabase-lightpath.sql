-- ============================================================
-- Workbench 轻量路径 · 数据库完整初始化 SQL
-- 生成：2026-09-09
-- 用途：三个独立 App（成就 / 目标 / 总结）共用一套 Supabase 库
-- 内容：8 张新表（fd_* / summary_* / user_settings）+ RLS + 字段映射对齐（4 处 DDL）
-- 特性：可重复执行（幂等）——已执行过的表/列/策略不会报错
-- 前置：Supabase 项目已启用邮件密码认证（auth.users）；旧 8 张成就表不受影响
-- 注意：策略采用 DROP POLICY IF EXISTS + CREATE POLICY（兼容 PostgreSQL 12+，旧版 Supabase 项目可用）
-- ============================================================

-- ────────────────────────────────────────────────
-- 第 1 部分：8 张新表（源自 app/supabase-migration-unified.sql）
-- ────────────────────────────────────────────────

-- FocusDesk 目标表
CREATE TABLE IF NOT EXISTS fd_goals (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE
);

-- FocusDesk 任务/灵感表（统一记录模型：fd_type 区分任务与灵感）
CREATE TABLE IF NOT EXISTS fd_tasks (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  goal_id TEXT REFERENCES fd_goals(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  fd_type TEXT NOT NULL DEFAULT 'task' CHECK (fd_type IN ('task', 'idea')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'idea', 'archived')),
  priority TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  subtasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort BIGINT NOT NULL DEFAULT 0,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE
);

-- FocusDesk 习惯表（长期打卡）
CREATE TABLE IF NOT EXISTS fd_habits (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  weekdays JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE
);

-- FocusDesk 习惯打卡记录表（按日期去重：habit_id + log_date 唯一）
CREATE TABLE IF NOT EXISTS fd_habit_logs (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  habit_id TEXT NOT NULL,
  log_date TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE
);

-- Summary Desk 总结记录表（日报/周报/自定义总结生成结果）
CREATE TABLE IF NOT EXISTS summary_docs (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'weekly' CHECK (kind IN ('daily', 'weekly', 'custom')),
  template_code TEXT,
  range_start TEXT,
  range_end TEXT,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE
);

-- Summary Desk 灵感库（方向：work/growth/none；tags 为字符串数组）
CREATE TABLE IF NOT EXISTS summary_ideas (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  content TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  direction TEXT NOT NULL DEFAULT 'none' CHECK (direction IN ('work', 'growth', 'none')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE
);

-- Summary Desk 工作日志（按 date 维度结构化记录）
CREATE TABLE IF NOT EXISTS summary_logs (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  date TEXT NOT NULL,
  matter TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '',
  issue TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP WITH TIME ZONE
);

-- 用户设置表（当前轻量路径暂不使用——LLM Key 按决定只存浏览器 localStorage；
-- 保留以兼容合并版 useSync 协议）
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  llm_provider TEXT,
  llm_api_key TEXT,
  llm_model TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_fd_goals_user_id ON fd_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_fd_tasks_user_id ON fd_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_fd_tasks_goal_id ON fd_tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_summary_docs_user_id ON summary_docs(user_id);
CREATE INDEX IF NOT EXISTS idx_summary_ideas_user_id ON summary_ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_summary_logs_user_id ON summary_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_summary_logs_date ON summary_logs(user_id, date);

-- 启用 RLS
ALTER TABLE fd_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd_habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE fd_habit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS 策略（CREATE OR REPLACE 保证重复执行幂等）
DROP POLICY IF EXISTS "Users can view their own fd_goals" ON fd_goals;
CREATE POLICY "Users can view their own fd_goals" ON fd_goals
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own fd_goals" ON fd_goals;
CREATE POLICY "Users can insert their own fd_goals" ON fd_goals
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own fd_goals" ON fd_goals;
CREATE POLICY "Users can update their own fd_goals" ON fd_goals
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own fd_goals" ON fd_goals;
CREATE POLICY "Users can delete their own fd_goals" ON fd_goals
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own fd_tasks" ON fd_tasks;
CREATE POLICY "Users can view their own fd_tasks" ON fd_tasks
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own fd_tasks" ON fd_tasks;
CREATE POLICY "Users can insert their own fd_tasks" ON fd_tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own fd_tasks" ON fd_tasks;
CREATE POLICY "Users can update their own fd_tasks" ON fd_tasks
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own fd_tasks" ON fd_tasks;
CREATE POLICY "Users can delete their own fd_tasks" ON fd_tasks
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own fd_habits" ON fd_habits;
CREATE POLICY "Users can view their own fd_habits" ON fd_habits
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own fd_habits" ON fd_habits;
CREATE POLICY "Users can insert their own fd_habits" ON fd_habits
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own fd_habits" ON fd_habits;
CREATE POLICY "Users can update their own fd_habits" ON fd_habits
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own fd_habits" ON fd_habits;
CREATE POLICY "Users can delete their own fd_habits" ON fd_habits
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own fd_habit_logs" ON fd_habit_logs;
CREATE POLICY "Users can view their own fd_habit_logs" ON fd_habit_logs
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own fd_habit_logs" ON fd_habit_logs;
CREATE POLICY "Users can insert their own fd_habit_logs" ON fd_habit_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own fd_habit_logs" ON fd_habit_logs;
CREATE POLICY "Users can delete their own fd_habit_logs" ON fd_habit_logs
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own summary_docs" ON summary_docs;
CREATE POLICY "Users can view their own summary_docs" ON summary_docs
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own summary_docs" ON summary_docs;
CREATE POLICY "Users can insert their own summary_docs" ON summary_docs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own summary_docs" ON summary_docs;
CREATE POLICY "Users can update their own summary_docs" ON summary_docs
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own summary_docs" ON summary_docs;
CREATE POLICY "Users can delete their own summary_docs" ON summary_docs
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own summary_ideas" ON summary_ideas;
CREATE POLICY "Users can view their own summary_ideas" ON summary_ideas
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own summary_ideas" ON summary_ideas;
CREATE POLICY "Users can insert their own summary_ideas" ON summary_ideas
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own summary_ideas" ON summary_ideas;
CREATE POLICY "Users can update their own summary_ideas" ON summary_ideas
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own summary_ideas" ON summary_ideas;
CREATE POLICY "Users can delete their own summary_ideas" ON summary_ideas
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own summary_logs" ON summary_logs;
CREATE POLICY "Users can view their own summary_logs" ON summary_logs
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own summary_logs" ON summary_logs;
CREATE POLICY "Users can insert their own summary_logs" ON summary_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own summary_logs" ON summary_logs;
CREATE POLICY "Users can update their own summary_logs" ON summary_logs
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own summary_logs" ON summary_logs;
CREATE POLICY "Users can delete their own summary_logs" ON summary_logs
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own settings" ON user_settings;
CREATE POLICY "Users can view their own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert their own settings" ON user_settings;
CREATE POLICY "Users can insert their own settings" ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own settings" ON user_settings;
CREATE POLICY "Users can update their own settings" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can delete their own settings" ON user_settings;
CREATE POLICY "Users can delete their own settings" ON user_settings
  FOR DELETE USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────
-- 第 2 部分：字段映射对齐（原版单文件 → 新表，4 处 DDL）
-- ────────────────────────────────────────────────

-- 1. fd_goals：状态枚举扩展，支持"已归档"目标（原版 FocusDesk 目标有五态）
ALTER TABLE fd_goals DROP CONSTRAINT IF EXISTS fd_goals_status_check;
ALTER TABLE fd_goals ADD CONSTRAINT fd_goals_status_check
  CHECK (status IN ('active', 'paused', 'done', 'archived'));

-- 2. fd_habits：补齐原版习惯字段（note / mode / countPerWeek）
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'weekday'
  CHECK (mode IN ('weekday', 'count'));
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS count_per_week INTEGER NOT NULL DEFAULT 0;

-- 3. fd_habit_logs：补齐打卡完成时间（原版记录 completedAt）
ALTER TABLE fd_habit_logs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

-- 4. summary_ideas：补齐素材来源（原版"转素材"后带 source 标记）
ALTER TABLE summary_ideas ADD COLUMN IF NOT EXISTS source TEXT;

-- ────────────────────────────────────────────────
-- 第 3 部分：执行后验证
-- ────────────────────────────────────────────────
-- 确认 8 张表都存在：
-- SELECT tablename FROM pg_tables
--   WHERE schemaname = 'public' AND tablename IN
--     ('fd_goals','fd_tasks','fd_habits','fd_habit_logs',
--      'summary_docs','summary_ideas','summary_logs','user_settings')
--   ORDER BY tablename;
--
-- 确认 4 处字段已就位：
-- SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public' AND (
--     (table_name='fd_habits' AND column_name IN ('note','mode','count_per_week'))
--     OR (table_name='fd_habit_logs' AND column_name='completed_at')
--     OR (table_name='summary_ideas' AND column_name='source'))
--   ORDER BY table_name, column_name;
