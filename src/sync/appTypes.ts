export type TodoTag = 'long-term' | 'one-time';

/** 成就商店商品分类 */
export type ShopCategory = 'life' | 'study' | 'work' | 'entertainment' | 'other';

/** 可同步实体的通用字段 - 同时支持 snake_case 和 camelCase */
export interface Syncable {
  synced_at?: string | null;
  syncedAt?: string | null;
  is_dirty?: boolean;
  isDirty?: boolean;
}

/**
 * 成就商店商品
 * 代表可以用成就值兑换的"小愿望"
 */
export interface ShopItem extends Syncable {
  id: string;
  name: string;                 // 商品名称
  description: string;          // 详细描述
  price: number;                // 所需成就值
  category: ShopCategory;       // 分类
  icon?: string;                // 图标名称（lucide icon）
  isPurchased: boolean;         // 是否已购买
  purchasedAt?: string | null;  // 购买时间
  createdAt: string;            // 创建时间
}

export interface Todo extends Syncable {
  id: string;
  title: string;
  createdAt: string;
  completedAt: string | null;
  isCompleted: boolean;
  isDelayed: boolean;
  delayCount: number;
  totalTime: number;
  isTiming: boolean;
  timingStartTime: string | null;
  timingRecordId: string | null;
  tag: TodoTag;
}

export type CheckInType = 'task' | 'commodity';

export interface CheckInProject extends Syncable {
  id: string;
  name: string;
  type: CheckInType;
  points: number;
  createdAt: string;
}

export interface CheckInRecord extends Syncable {
  id: string;
  projectId: string;
  projectName: string;
  type: CheckInType;
  points: number;
  createdAt: string;
}

export interface TimeRecord extends Syncable {
  id: string;
  startTime: string;
  endTime: string;
  content: string;
  note: string;
  createdAt: string;
  todoId: string | null;
  startTimestamp: number;
}

export interface AchievementLog extends Syncable {
  id: string;
  type: 'todo' | 'task' | 'commodity' | 'shop_purchase';
  title: string;
  points: number;
  createdAt: string;
  shopItemId?: string;  // 关联的商店商品ID
}

export interface Inspiration extends Syncable {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DailyStats {
  date: string;
  totalAchievements: number;
  checkInCount: number;
}

export interface AppState {
  todos: Todo[];
  checkInProjects: CheckInProject[];
  checkInRecords: CheckInRecord[];
  timeRecords: TimeRecord[];
  achievementLogs: AchievementLog[];
  inspirations: Inspiration[];
  shopItems: ShopItem[];  // 成就商店商品
  totalAchievements: number;
  totalEarned: number;
  totalSpent: number;
  userStats: {
    total_achievements?: number;
    total_earned?: number;
    total_spent?: number;
  };
  // ─── FocusDesk（目标追踪）───
  fdGoals: FdGoal[];
  fdTasks: FdTask[];
  fdHabits: FdHabit[];
  fdHabitLogs: FdHabitLog[];
  // ─── Summary Desk（内容总结）───
  summaryDocs: SummaryDoc[];
  summaryIdeas: SummaryIdea[];
  summaryLogs: SummaryLog[];
  userSettings: UserSettings;
}

// ════════════════════════════════════════════
// FocusDesk（目标追踪工作台）
// ════════════════════════════════════════════

/** FocusDesk 记录状态（对应原应用：待处理/进行中/已完成/待转化/归档） */
export type FdStatus = 'todo' | 'doing' | 'done' | 'idea' | 'archived';

/** FocusDesk 记录类型（任务 / 灵感） */
export type FdType = 'task' | 'idea';

/** 嵌套子任务（对应原应用 subtasks 树） */
export interface FdSubtask {
  id: string;
  text: string;
  done: boolean;
  children?: FdSubtask[];
}

/** FocusDesk 目标 */
export interface FdGoal extends Syncable {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'paused' | 'done';
  progress: number;            // 0-100
  sort: number;
  createdAt: string;
  updatedAt: string;
}

/** FocusDesk 任务/灵感 */
export interface FdTask extends Syncable {
  id: string;
  title: string;
  fdType: FdType;
  status: FdStatus;
  priority: string;            // 'P0' | 'P1' | 'P2' | 'P3' | ''
  owner: string;
  dueDate: string;             // 'YYYY-MM-DD' 或 ''
  tags: string;
  note: string;
  goalId: string | null;       // 关联目标
  subtasks: FdSubtask[];
  sort: number;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
}

/** FocusDesk 习惯（长期打卡） */
export interface FdHabit extends Syncable {
  id: string;
  name: string;
  weekdays: number[];          // 0=周一 … 6=周日
  sort: number;
  createdAt: string;
}

/** FocusDesk 习惯打卡记录（按 habitId+logDate 去重） */
export interface FdHabitLog extends Syncable {
  id: string;
  habitId: string;
  logDate: string;             // 'YYYY-MM-DD'
  createdAt: string;
}

// ════════════════════════════════════════════
// Summary Desk（内容总结工作台）
// ════════════════════════════════════════════

/** 素材（工作 / 个人成长两个方向） */
export interface SummarySource {
  id: string;
  text: string;
  dir: 'work' | 'growth';
  date: string;                // 'YYYY-MM-DD'
}

/** 生成的日报/周报/总结文档 */
export interface SummaryDoc extends Syncable {
  id: string;
  title: string;
  kind: 'daily' | 'weekly' | 'custom';
  templateCode: string;
  rangeStart: string;
  rangeEnd: string;
  sources: SummarySource[];
  summary: string;             // Markdown 结果
  provider: string;
  model: string;
  createdAt: string;
}

/** LLM 设置（存 Supabase user_settings，跨设备同步） */
export interface UserSettings {
  llmProvider: string;         // deepseek | volcengine | openai | zhipu | custom | ''
  llmApiKey: string;
  llmModel: string;
}

/** 灵感条目（Summary Desk 灵感库） */
export interface SummaryIdea extends Syncable {
  id: string;
  content: string;
  tags: string[];              // 标签
  direction: 'work' | 'growth' | 'none';   // 方向（工作/个人成长/未分类）
  createdAt: string;
}

/** 工作日志条目（Summary Desk 工作日志） */
export interface SummaryLog extends Syncable {
  id: string;
  date: string;                // 'YYYY-MM-DD'
  matter: string;              // 事项
  result: string;              // 结果
  data: string;                // 数据
  issue: string;               // 问题
  createdAt: string;
}