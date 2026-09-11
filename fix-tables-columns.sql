-- ============================================================
-- 补齐 8 张轻量路径新表的缺失列（幂等，可重复执行）
-- 原因：旧版残留表（如 fd_goals 只有 3 列）导致 CREATE TABLE IF NOT EXISTS 被跳过，
--       列缺失 → upsert 整批失败 → 数据上传不到 Supabase。
-- 用法：Supabase SQL Editor 直接粘贴执行；执行后可用文末查询验证。
-- ============================================================

-- ── 1. fd_goals（重点：旧版残留表，缺 description/status/progress/sort/时间列） ──
ALTER TABLE fd_goals ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE fd_goals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE fd_goals ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fd_goals ADD COLUMN IF NOT EXISTS sort INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fd_goals ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE fd_goals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE fd_goals ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE fd_goals DROP CONSTRAINT IF EXISTS fd_goals_status_check;
ALTER TABLE fd_goals ADD CONSTRAINT fd_goals_status_check
  CHECK (status IN ('active', 'paused', 'done', 'archived'));
ALTER TABLE fd_goals DROP CONSTRAINT IF EXISTS fd_goals_progress_check;
ALTER TABLE fd_goals ADD CONSTRAINT fd_goals_progress_check
  CHECK (progress >= 0 AND progress <= 100);

-- ── 2. fd_tasks ──
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS goal_id TEXT;
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS fd_type TEXT NOT NULL DEFAULT 'task';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS due_date TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS subtasks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS sort BIGINT NOT NULL DEFAULT 0;
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE fd_tasks ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE fd_tasks DROP CONSTRAINT IF EXISTS fd_tasks_fd_type_check;
ALTER TABLE fd_tasks ADD CONSTRAINT fd_tasks_fd_type_check CHECK (fd_type IN ('task', 'idea'));
ALTER TABLE fd_tasks DROP CONSTRAINT IF EXISTS fd_tasks_status_check;
ALTER TABLE fd_tasks ADD CONSTRAINT fd_tasks_status_check
  CHECK (status IN ('todo', 'doing', 'done', 'idea', 'archived'));

-- ── 3. fd_habits ──
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS weekdays JSONB NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb;
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS sort INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'weekday';
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS count_per_week INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE fd_habits ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE fd_habits DROP CONSTRAINT IF EXISTS fd_habits_mode_check;
ALTER TABLE fd_habits ADD CONSTRAINT fd_habits_mode_check CHECK (mode IN ('weekday', 'count'));

-- ── 4. fd_habit_logs ──
ALTER TABLE fd_habit_logs ADD COLUMN IF NOT EXISTS habit_id TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_habit_logs ADD COLUMN IF NOT EXISTS log_date TEXT NOT NULL DEFAULT '';
ALTER TABLE fd_habit_logs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE fd_habit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE fd_habit_logs ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;

-- ── 5. summary_docs ──
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'weekly';
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS template_code TEXT;
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS range_start TEXT;
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS range_end TEXT;
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '';
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE summary_docs ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE summary_docs DROP CONSTRAINT IF EXISTS summary_docs_kind_check;
ALTER TABLE summary_docs ADD CONSTRAINT summary_docs_kind_check CHECK (kind IN ('daily', 'weekly', 'custom'));

-- ── 6. summary_ideas ──
ALTER TABLE summary_ideas ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '';
ALTER TABLE summary_ideas ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE summary_ideas ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'none';
ALTER TABLE summary_ideas ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE summary_ideas ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE summary_ideas ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE summary_ideas DROP CONSTRAINT IF EXISTS summary_ideas_direction_check;
ALTER TABLE summary_ideas ADD CONSTRAINT summary_ideas_direction_check
  CHECK (direction IN ('work', 'growth', 'none'));

-- ── 7. summary_logs ──
ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS date TEXT NOT NULL DEFAULT '';
ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS matter TEXT NOT NULL DEFAULT '';
ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS result TEXT NOT NULL DEFAULT '';
ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS data TEXT NOT NULL DEFAULT '';
ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS issue TEXT NOT NULL DEFAULT '';
ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE summary_logs ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP WITH TIME ZONE;

-- ── 8. user_settings ──
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS llm_provider TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS llm_api_key TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS llm_model TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ── 索引（补建，幂等） ──
CREATE INDEX IF NOT EXISTS idx_fd_goals_user_id ON fd_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_fd_tasks_user_id ON fd_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_fd_tasks_goal_id ON fd_tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_summary_docs_user_id ON summary_docs(user_id);
CREATE INDEX IF NOT EXISTS idx_summary_ideas_user_id ON summary_ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_summary_logs_user_id ON summary_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_summary_logs_date ON summary_logs(user_id, date);

-- ── 验证：fd_goals 应有 11 列 ──
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'fd_goals'
ORDER BY ordinal_position;
