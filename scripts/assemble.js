// 组装构建：导航页 → dist 根，achieve → dist/achieve，单文件 HTML → 各自子路径
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const run = (cmd, cwd) => {
  console.log(`> [assemble] ${cmd} (cwd: ${path.relative(root, cwd) || '.'})`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
};

// 1. 构建导航页（输出到 dist/）
run('npm run build:portal', root);

// 2. 构建 Achievement（副本，base=/achieve/）
run('npm ci && npm run build', path.join(root, 'achieve'));

// 3. 组装：把三个 app 放进 dist 对应子路径
fs.mkdirSync(path.join(dist, 'achieve'), { recursive: true });
fs.cpSync(path.join(root, 'achieve', 'dist'), path.join(dist, 'achieve'), { recursive: true });

fs.mkdirSync(path.join(dist, 'focusdesk'), { recursive: true });
fs.cpSync(path.join(root, 'focusdesk', 'index.html'), path.join(dist, 'focusdesk', 'index.html'));

fs.mkdirSync(path.join(dist, 'summarydesk'), { recursive: true });
fs.cpSync(path.join(root, 'summarydesk', 'index.html'), path.join(dist, 'summarydesk', 'index.html'));

// 4. 注入 Supabase 环境变量（Vercel 构建时读环境变量；本地读取 gswdb/.env）
injectEnv(path.join(dist, 'focusdesk', 'index.html'));
injectEnv(path.join(dist, 'summarydesk', 'index.html'));

console.log('[assemble] OK → dist/{index.html,achieve/,focusdesk/,summarydesk/}');

// —— 工具函数：把 __VITE_SUPABASE_URL__ / __VITE_SUPABASE_ANON_KEY__ 占位符替换为真实值 ——
function injectEnv(htmlPath) {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL || '';
  const key = env.VITE_SUPABASE_ANON_KEY || '';
  if (!url || !key) {
    console.warn(`[assemble] 警告：未找到 VITE_SUPABASE_URL/ANON_KEY，${path.basename(htmlPath)} 将以纯本地模式运行`);
    return;
  }
  let html = fs.readFileSync(htmlPath, 'utf8');
  const before = html;
  html = html.split('__VITE_SUPABASE_URL__').join(url);
  html = html.split('__VITE_SUPABASE_ANON_KEY__').join(key);
  if (html === before) {
    console.warn(`[assemble] 警告：${path.basename(htmlPath)} 未包含占位符，跳过注入`);
    return;
  }
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`[assemble] 已注入 Supabase 环境变量 → dist/${path.relative(dist, htmlPath).split(path.sep).join('/')}`);
}

function loadEnv() {
  // Vercel 构建环境：直接使用 process.env
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return process.env;
  }
  // 本地构建：读取 gswdb/.env（KEY=value 行，忽略注释）
  const envFile = path.join(root, '.env');
  const env = {};
  try {
    const raw = fs.readFileSync(envFile, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) {
    console.warn('[assemble] 未找到 .env，使用空配置');
  }
  return env;
}
