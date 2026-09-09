import { useEffect, useMemo, useState } from 'react';
import {
  Trophy, Target, FileText, Upload, Download, LogOut,
  Wifi, WifiOff, RefreshCw, Mail, Lock, UserPlus, LogIn, HardDrive,
} from 'lucide-react';
import { auth } from './sync/database';
import { useSync } from './sync/useSync';
import { isItemDirty } from './sync/utils/syncState';
import type { User } from '@supabase/supabase-js';

const APP_ENTRIES = [
  { name: '成就系统', desc: '打卡 · 时间记录 · 成就商店', href: '/achieve/', icon: Trophy, color: '#3B6EF6' },
  { name: '目标系统', desc: '目标拆解 · 任务 · 习惯打卡', href: '/focusdesk/', icon: Target, color: '#0FA47F' },
  { name: '总结系统', desc: '灵感 · 工作日志 · 周报生成', href: '/summarydesk/', icon: FileText, color: '#B4631F' },
] as const;

type LocalMode = 'cloud' | 'local';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<LocalMode>('cloud');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    auth.getCurrentUser().then((u) => {
      setUser(u);
      setChecking(false);
    });
    const sub = auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') { setMode('cloud'); setUser(session?.user ?? null); }
      if (event === 'SIGNED_OUT') setUser(null);
    });
    return () => sub.data.subscription.unsubscribe();
  }, []);

  // 同步协议：登录用户 ID；未登录（含本地模式）传 null，仅读写 localStorage
  const { syncState, loadLocalData, performSync, fetchFromCloud } = useSync(user?.id ?? null);

  // 三组数据概览：成就 / 目标 / 总结
  const overview = useMemo(() => {
    const data = loadLocalData();
    const groups = [
      {
        key: '成就数据',
        items: [
          ...data.todos, ...data.checkInProjects, ...data.checkInRecords,
          ...data.timeRecords, ...data.achievementLogs,
          ...data.inspirations, ...data.shopItems,
        ] as any[],
      },
      { key: '目标数据', items: [...(data.fdGoals ?? []), ...(data.fdTasks ?? []), ...(data.fdHabits ?? []), ...(data.fdHabitLogs ?? [])] as any[] },
      { key: '总结数据', items: [...(data.summaryDocs ?? []), ...(data.summaryIdeas ?? []), ...(data.summaryLogs ?? [])] as any[] },
    ];
    return groups.map((g) => ({
      ...g,
      count: g.items.length,
      dirty: g.items.filter((i) => isItemDirty(i)).length,
    }));
  }, [loadLocalData, syncState.lastSync, syncState.isSyncing]);

  if (checking) return <div className="page"><div className="muted">加载中…</div></div>;

  const showPortal = !!user || mode === 'local';

  return (
    <div className="page">
      <header className="head">
        <div>
          <h1>个人工作台</h1>
          <p className="muted">成就 · 目标 · 总结，统一账号与数据</p>
        </div>
        {user && (
          <button className="btn-ghost" onClick={() => auth.signOut()}>
            <LogOut size={14} /> 退出
          </button>
        )}
      </header>

      {!showPortal ? (
        <AuthCard mode={mode} setMode={setMode} />
      ) : (
        <>
          <section className="grid-3">
            {APP_ENTRIES.map((a) => (
              <a key={a.href} className="entry" href={a.href} style={{ '--ac': a.color } as React.CSSProperties}>
                <div className="entry-ic"><a.icon size={22} /></div>
                <div className="entry-name">{a.name}</div>
                <div className="entry-desc">{a.desc}</div>
                <div className="entry-go">打开 →</div>
              </a>
            ))}
          </section>

          {user ? (
            <SyncCard
              user={user}
              syncState={syncState}
              overview={overview}
              onSync={() => performSync(user.id)}
              onFetch={() => fetchFromCloud(user.id)}
            />
          ) : (
            <section className="card local-banner">
              <HardDrive size={16} />
              <div>
                <b>本地模式</b>：数据仅保存在本机浏览器。
                <span className="muted small">登录后可在导航页一键云端同步，三个应用数据互通。</span>
              </div>
              <button className="btn-primary" onClick={() => setMode('cloud')}>
                <LogIn size={15} /> 登录
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function AuthCard({ mode, setMode }: { mode: LocalMode; setMode: (m: LocalMode) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (isSignUp && password !== confirm) {
      setMsg({ text: '两次输入的密码不一致', type: 'error' });
      return;
    }
    setBusy(true);
    if (isSignUp) {
      const { error } = await auth.signUp(email, password);
      if (error) setMsg({ text: error.message, type: 'error' });
      else { setMsg({ text: '注册成功，请登录', type: 'success' }); setIsSignUp(false); setPassword(''); setConfirm(''); }
    } else {
      const { error } = await auth.signIn(email, password);
      if (error) setMsg({ text: error.message, type: 'error' });
    }
    setBusy(false);
  };

  return (
    <section className="card auth-card">
      <h2>{isSignUp ? '注册账号' : '登录'}</h2>
      <p className="muted small">一个账号，三个应用通用；数据云端同步</p>
      {msg && <div className={`toast ${msg.type}`}>{msg.text}</div>}
      <form onSubmit={submit} className="col">
        <div className="field">
          <label className="flabel">邮箱</label>
          <div className="fwrap">
            <Mail size={15} className="ficon" />
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
        </div>
        <div className="field">
          <label className="flabel">密码</label>
          <div className="fwrap">
            <Lock size={15} className="ficon" />
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} />
          </div>
        </div>
        {isSignUp && (
          <div className="field">
            <label className="flabel">确认密码</label>
            <div className="fwrap">
              <Lock size={15} className="ficon" />
              <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="再次输入密码" required />
            </div>
          </div>
        )}
        <button className="btn-primary" disabled={busy}>
          {isSignUp ? <UserPlus size={15} /> : <LogIn size={15} />}
          {isSignUp ? '注册' : '登录'}
        </button>
      </form>
      <button className="btn-ghost wide" onClick={() => setIsSignUp(!isSignUp)}>
        {isSignUp ? '已有账户？去登录' : '没有账户？注册一个'}
      </button>
      <div className="divider" />
      <button className="btn-soft wide" onClick={() => setMode('local')}>
        <HardDrive size={15} /> 本地模式（跳过登录）
      </button>
      {mode === 'local' && (
        <p className="muted tiny center">本地模式仅浏览本机数据，登录后可云端同步</p>
      )}
    </section>
  );
}

function SyncCard({ user, syncState, overview, onSync, onFetch }: {
  user: User;
  syncState: ReturnType<typeof useSync>['syncState'];
  overview: { key: string; count: number; dirty: number }[];
  onSync: () => void;
  onFetch: () => void;
}) {
  return (
    <section className="card sync-card">
      <div className="sync-head">
        <h2>数据同步</h2>
        <span className={`pill ${syncState.isOnline ? 'on' : 'off'}`}>
          {syncState.isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
          {syncState.isOnline ? '在线' : '离线'}
        </span>
      </div>

      <div className="ov-grid">
        {overview.map((g) => (
          <div key={g.key} className="ov-item">
            <div className="ov-name">{g.key}</div>
            <div className="ov-num">
              {g.count}
              {g.dirty > 0 && <span className="dirty">待同步 {g.dirty}</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="sync-actions">
        <button className="btn-primary" onClick={onSync} disabled={syncState.isSyncing || !syncState.isOnline}>
          {syncState.isSyncing ? <RefreshCw size={15} className="spin" /> : <Upload size={15} />}
          上传并合并
        </button>
        <button className="btn-soft" onClick={onFetch} disabled={syncState.isSyncing || !syncState.isOnline}>
          <Download size={15} /> 从云端下载
        </button>
      </div>

      <div className="sync-meta muted small">
        {syncState.lastSync ? `最后同步：${new Date(syncState.lastSync).toLocaleString('zh-CN')}` : '尚未同步'}
        <span className="acct">账号：{user.email}</span>
      </div>
      {syncState.syncMessage && <div className="sync-msg">{syncState.syncMessage}</div>}
    </section>
  );
}
