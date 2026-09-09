# Handoff — Achieve-system 成就系统

> 项目路径：`Workbench-Unified/_originals/Achieve-system`
> 项目性质：**原始版本备份**（`_originals` 目录下），迁移/重构前的基线版本
> 最后校验：2026-09-09

---

## 1. 项目一句话定位

一个 **Local-First（本地优先）的个人生产力 Web App**，整合了待办、打卡、时间记录、灵感板、成就积分、奖励商店 6 大模块；数据存浏览器 localStorage，登录 Supabase 后可手动双向同步到云端，实现多设备使用。

---

## 2. 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | React 19 + TypeScript 5.8 + Vite 6 |
| 样式 | Tailwind CSS 3.4 |
| 图标 | lucide-react |
| 后端 / 云同步 | Supabase（Auth + PostgreSQL + RLS） |
| 状态管理 | 自定义 Hook `useAppState`（localStorage 持久化，无 Redux/Zustand） |
| 构建产物 | 静态文件（`dist/`），任意静态托管可部署 |

关键依赖版本见 [package.json](package.json)。

---

## 3. 功能模块一览

底部导航 6 个 Tab 对应主要功能：

| Tab | 组件 | 核心能力 |
|---|---|---|
| 待办 Todo | `TodoList.tsx` | 增删改、完成/取消（±5 积分）、拖延标记（-2 分）、置顶、计时器、长期/一次性标签 |
| 打卡 Check-in | `CheckInSystem.tsx` | 自定义打卡项目（任务型加分 / 消费型扣分）、打卡即生成成就流水 |
| 时间记录 Time | `TimeRecorder.tsx` | 手动起止计时、备注、与 Todo 关联自动累计 totalTime |
| 成就 Achievement | `AchievementSystem.tsx` | 积分流水日志（来源：todo / check-in / shop）、累计收支 |
| 灵感 Inspiration | `InspirationBoard.tsx` | 灵感便签、一键转 Todo、置顶、编辑 |
| 商店 Shop | `AchievementShop.tsx` | 自定义商品、积分兑换、分类管理 |

通用组件：
- `CalendarView.tsx` — 日历视图，日/月/年统计
- `DateDetail.tsx` — 当日记录详情（打卡/时间/成就）
- `DataSync.tsx` — 同步面板（上传/下载/导入/导出）
- `Auth.tsx` — Supabase 邮箱登录
- `Toast.tsx` — 消息提示
- `Navigation.tsx` / `BottomNavigation.tsx` — 顶部/底部导航

---

## 4. 架构核心：状态与同步

### 4.1 状态管理

- **单一 Store**：`src/store/index.ts` 的 `useAppState` Hook
- **持久化键**：`localStorage` → `work-status-app-data`
- **状态结构** `AppState`：
  - `todos[]` / `checkInProjects[]` / `checkInRecords[]` / `timeRecords[]`
  - `achievementLogs[]` / `inspirations[]` / `shopItems[]`
  - `totalAchievements` / `totalEarned` / `totalSpent`（由 achievementLogs 实时计算，不信任 userStats）

### 4.2 积分规则（成就系统核心）

| 动作 | 积分变化 | 类型 |
|---|---|---|
| 完成 Todo | +5 | `todo` |
| 取消完成 Todo | -5 | `todo` |
| 标记拖延 Todo | -2 | `task` |
| 任务型打卡 | +项目设定值 | `task` |
| 消费型打卡 | -项目设定值 | `commodity` |
| 商店购买 | -商品价格 | `shop_purchase` |

> 所有积分变动都写入 `achievementLogs`，余额 = 总收入 − 总支出，**从日志反算，不存独立余额字段**（避免不一致）。

### 4.3 同步模型（重中之重）

**模式：手动同步 + 增量脏标记**

- 自动保存到本地 ✅；自动上传 ❌（用户手动点"同步到云端"才上传）
- 每条可同步记录都有 `is_dirty` / `isDirty`（双写，兼容 snake_case 和 camelCase）
- `synced_at` / `syncedAt` 记录上次同步时间
- 删除用 **墓碑机制**：`work-status-app-deleted-ids` 存已删 ID，同步时批量删云端

**同步流程（`src/hooks/useSync.ts` 的 `performSync`）**：

```
1. 并发守卫（isSyncingRef） + 清除待处理定时器
2. 处理本地删除 → 云端 deleteBatch
3. 统计 dirty 记录数
4. 无脏数据 → 只 fetchAll 拉取云端，merge 回本地
5. 有脏数据 → syncAll 上传 → fetchAll 拉回最新 → merge
6. 回调 onDataFetched 更新 React state
```

**合并策略（`mergeData` 函数）**：
- 本地 dirty → 保留本地（performSync 后清脏标记）
- 两边都干净 → 取 `synced_at` 较新的
- 只有云端 → 收进来（其他设备新增的）
- 只有本地 + dropSyncedLocalOnly=true → 丢弃（云端已删的）
- 最后按 `createdAt` 倒序

**7 张同步表**：
`todos` / `check_in_projects` / `check_in_records` / `time_records` / `achievement_logs` / `inspirations` / `shop_items`

> 记录类型差异：todos / projects / inspirations / shopItems / timeRecords 是 upsert 型（可修改）；checkInRecords / achievementLogs 是 append 型（只追加不修改）。

### 4.4 导入导出

- **JSON 全量导出/导入**：最完整的备份格式；导入会清除同步时间戳、标记为脏，作为新数据可上传到当前账号
- **CSV**：简单表格数据，有损，不作为完整备份
- 导入前建议先导出当前数据做备份

---

## 5. 目录结构速览

```
Achieve-system/
├── src/
│   ├── components/       # 13 个 UI 组件
│   ├── hooks/
│   │   └── useSync.ts    # ⭐ 同步核心 Hook
│   ├── store/
│   │   └── index.ts      # ⭐ 全局状态 + 所有业务动作
│   ├── supabase/
│   │   ├── client.ts     # Supabase 客户端初始化
│   │   ├── database.ts   # 数据库 CRUD + syncAll/fetchAll/deleteBatch
│   │   └── types.ts      # Supabase 类型
│   ├── utils/            # 同步工具函数（5个 sync*.ts + importState + checkInStats）
│   ├── types/
│   │   └── index.ts      # 前端类型定义
│   ├── App.tsx           # 主应用 + 路由分发
│   └── main.tsx
├── migrations/
│   └── 001_add_shop_purchase_type.sql   # 商店购买类型迁移
├── docs/
│   ├── SYNC-BUGFIX-SUMMARY.md           # 同步 Bug 修复总结
│   └── FIX_SHOP_SYNC.md                 # 商店同步修复记录
├── tests/                  # 同步回归测试（.mjs + .ts）
├── scripts/
│   ├── zip.js              # 打包 dist.zip
│   └── fix-package.js
├── supabase-migrations.sql # ⭐ 建表 + RLS 策略完整 SQL
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── .env.example
└── README.md
```

---

## 6. 已知的坑 & 历史问题

> 以下在 `docs/` 里有详细修复记录，接手人遇到类似问题先查文档。

| 问题 | 位置 | 状态 |
|---|---|---|
| 同步无限循环（dirty 标记未正确清除） | `useSync.ts` `mergeData` | ✅ 已修复（shouldMarkSynced 参数） |
| 商店购买记录不同步到云端 | shop 相关 + sync | ✅ 已修复（见 `docs/FIX_SHOP_SYNC.md`） |
| 多端同步竞态条件 | `useSync.ts` | ✅ 已修复（isSyncingRef 并发守卫 + 清定时器） |
| 导入数据后其他设备看不到 | 导入时清 syncedAt 标记为 dirty | ✅ 设计如此，需手动上传 |
| snake_case / camelCase 双字段兼容 | 所有 syncable 记录 | ✅ 双写保证两端兼容 |
| `purchaseShopItem` 返回值与实际状态不一致 | `store/index.ts:647-688` | ⚠️ 小问题：setState 是异步的，return 用的是旧 state；实际 UI 显示正确但函数返回值可能不准 |

---

## 7. 本地启动步骤

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 填入 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY

# 3. 初始化 Supabase（SQL Editor 执行）
# 打开 supabase-migrations.sql，全部执行

# 4. 启动开发服务器
npm run dev

# 5. 构建生产包
npm run build
# 或构建+打包成 zip
npm run build:zip
```

---

## 8. 部署

- 纯静态应用，`dist/` 目录丢到任何静态托管即可
- 环境变量在构建时注入（Vite 的 `VITE_` 前缀）
- 已提供 `dist.zip` 作为历史构建快照（294KB，2026-06-08）

---

## 9. 相关文档索引

- [README.md](README.md) — 官方说明（英文，含同步模型、备份导入、故障排查）
- [docs/SYNC-BUGFIX-SUMMARY.md](docs/SYNC-BUGFIX-SUMMARY.md) — 同步 Bug 修复总览
- [docs/FIX_SHOP_SYNC.md](docs/FIX_SHOP_SYNC.md) — 商店同步专项修复记录
- [supabase-migrations.sql](supabase-migrations.sql) — 数据库 Schema 完整定义
- [migrations/001_add_shop_purchase_type.sql](migrations/001_add_shop_purchase_type.sql) — 增量迁移脚本

---

## 10. 接手建议（从哪里开始看）

1. **先跑起来** — 配好 Supabase 跑 `npm run dev`，把 6 个 Tab 都点一遍建立直觉
2. **读状态层** — `src/store/index.ts`（所有数据怎么变的都在这里）
3. **读同步层** — `src/hooks/useSync.ts`（最复杂也最核心的部分）
4. **读数据库** — `supabase-migrations.sql`（表结构和 RLS 策略）
5. **读修复文档** — `docs/` 下两篇，了解历史踩坑点避免重踩
