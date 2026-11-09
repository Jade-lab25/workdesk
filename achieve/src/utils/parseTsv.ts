// 粘贴 TSV 批量补录的纯函数解析层。
// 无 React/DOM/store 依赖，可被 tests/*.mjs 以 Node 原生 TS 擦除模式直接加载。
// 设计口径：只做格式兼容，不做内容语义判断；任何格式合法的行一律可导入，
// 分心次数列识别后丢弃，重复/时长不一致只出 warning 不阻断。

export type TsvFieldKey = 'date' | 'start' | 'end' | 'duration' | 'content' | 'note' | 'distraction';
export type TsvRowStatus = 'valid' | 'error';

export interface ParsedTsvRow {
  /** 原始文本 1-based 行号（计入被跳过的空行），错误定位用 */
  sourceLine: number;
  status: TsvRowStatus;
  /** 格式层致命原因（中文）；非空即 error，不参与导入 */
  errors: string[];
  /** 非阻断提示：时长不一致、疑似重复 */
  warnings: string[];
  /** 归一化 YYYY-MM-DD；无法解析为 '' */
  date: string;
  /** 本地时区 ISO；无法解析为 '' */
  startISO: string;
  endISO: string;
  /** 专注事项 trim 后原文，内部字符不做全角转换 */
  content: string;
  /** 进展记录单元格 trim 后原文；空即 '' */
  note: string;
  durationSeconds: number | null;
  actualSeconds: number | null;
}

export interface TsvParseResult {
  rows: ParsedTsvRow[];
  headerDetected: boolean;
  columnMap: Partial<Record<TsvFieldKey, number>>;
  ignoredBlankLines: number;
  summary: { total: number; valid: number; error: number; duplicateHints: number };
}

export interface ParseTsvOptions {
  /** 仅用于生成疑似重复提示，可省略；解析器只读取不修改 */
  existingKeys?: Set<string>;
}

export interface ManualTimeEntry {
  content: string;
  startTime: string;
  endTime: string;
  note: string;
}

// 无表头时的固定列位置（与任务栏计时器工具的导出顺序一致）
const FALLBACK_COLUMNS: TsvFieldKey[] = ['date', 'start', 'end', 'duration', 'content', 'note', 'distraction'];
const REQUIRED_FIELDS: TsvFieldKey[] = ['date', 'start', 'end', 'content'];

const HEADER_ALIASES: Record<TsvFieldKey, string[]> = {
  date: ['日期', 'date'],
  start: ['开始时间', '开始', 'start'],
  end: ['结束时间', '结束', 'end'],
  duration: ['时长', '用时', 'duration'],
  content: ['专注事项', '事项', '任务', '任务内容', '内容', 'content'],
  note: ['进展记录', '进展', '备注', '记录', 'note'],
  distraction: ['分心次数', '分心'],
};

const FIELD_DISPLAY_NAME: Record<TsvFieldKey, string> = {
  date: '日期',
  start: '开始时间',
  end: '结束时间',
  duration: '时长',
  content: '专注事项',
  note: '进展记录',
  distraction: '分心次数',
};

const BOM = '﻿';

/**
 * 整段文本的 TSV 词法切分（引号感知）。
 * 引号外 Tab 切列、换行切行；引号内 Tab/换行都是单元格内容；"" 还原为单个 "。
 * 硬编码 Tab 分隔，逗号不做特殊处理。
 */
export function tokenizeTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const s = text.startsWith(BOM) ? text.slice(1) : text;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      // 仅单元格开头的引号是引用符，中间出现的引号按字面处理
      inQuotes = true;
    } else if (ch === '\t') {
      pushCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++; // CRLF 视作一个换行
      pushRow();
    } else {
      cell += ch;
    }
  }

  // 文本不以换行结尾时收尾
  if (cell !== '' || row.length > 0) pushRow();
  return rows;
}

/** 全角数字/冒号 → 半角（仅用于时间类字段，自由文本不许过这个） */
function toHalfWidth(s: string): string {
  return s.replace(/[０-９：]/g, (ch) => {
    if (ch === '：') return ':';
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });
}

/** 日期归一化，接受 YYYY-MM-DD / YYYY/M/D / YYYY.M.D / YYYY年M月D日，带日历回环校验 */
function normalizeDate(raw: string): string | null {
  const s = toHalfWidth(raw.trim());
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(year, month - 1, day);
  // 拦截 2026-02-30、2026-13-01 这类 Date 自动滚转的非法值
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
    return null;
  }
  return `${m[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface ParsedClock {
  h: number;
  m: number;
  s: number;
}

/** 时间解析，接受 H:MM / HH:MM / HH:MM:SS，带范围校验 */
function parseClock(raw: string): ParsedClock | null {
  const t = toHalfWidth(raw.trim());
  const m = t.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] ? Number(m[3]) : 0;
  if (h > 23 || min > 59 || sec > 59) return null;
  return { h, m: min, s: sec };
}

/** 时长解析：MM:SS / H:MM:SS / 纯数字（分钟），返回秒；无法解析返回 null */
function parseDuration(raw: string): number | null {
  const t = toHalfWidth(raw.trim());
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) * 60;
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  return hours * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function formatClockDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const min = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function toLocalISO(ymd: string, clock: ParsedClock): string {
  const hh = String(clock.h).padStart(2, '0');
  const mm = String(clock.m).padStart(2, '0');
  const ss = String(clock.s).padStart(2, '0');
  // 不带时区后缀的字符串按本地时区解析，与 TimeRecorder 手动补录严格同一表达式
  return new Date(`${ymd}T${hh}:${mm}:${ss}`).toISOString();
}

function matchHeaderField(cell: string): TsvFieldKey | null {
  const normalized = cell.trim().toLowerCase();
  for (const field of Object.keys(HEADER_ALIASES) as TsvFieldKey[]) {
    if (HEADER_ALIASES[field].includes(normalized)) return field;
  }
  return null;
}

function isBlankRow(row: string[]): boolean {
  return row.every(cell => cell.trim() === '');
}

/** 疑似重复键，组件构建 existingKeys 与解析器批内去重共用 */
export function buildTimeRecordKey(startISO: string, endISO: string, content: string): string {
  return `${startISO}|${endISO}|${content.trim()}`;
}

export function parseTsv(text: string, options: ParseTsvOptions = {}): TsvParseResult {
  const grid = tokenizeTsv(text);
  const existingKeys = options.existingKeys ?? new Set<string>();
  let ignoredBlankLines = 0;

  // 找首个非空行（空行的 sourceLine 仍占用原始行号，所以要先计数）
  let firstNonBlank = -1;
  grid.forEach((row, idx) => {
    if (isBlankRow(row)) {
      ignoredBlankLines++;
    } else if (firstNonBlank === -1) {
      firstNonBlank = idx;
    }
  });

  let headerDetected = false;
  const columnMap: Partial<Record<TsvFieldKey, number>> = {};
  let dataStart = 0;

  if (firstNonBlank !== -1) {
    const headerHits: { field: TsvFieldKey; index: number }[] = [];
    grid[firstNonBlank].forEach((cell, index) => {
      const field = matchHeaderField(cell);
      if (field && !headerHits.some(hit => hit.field === field)) {
        headerHits.push({ field, index }); // 重名列取首个
      }
    });
    if (headerHits.length >= 2) {
      headerDetected = true;
      dataStart = firstNonBlank + 1;
      for (const { field, index } of headerHits) columnMap[field] = index;
    }
  }

  if (!headerDetected) {
    FALLBACK_COLUMNS.forEach((field, index) => {
      columnMap[field] = index;
    });
  }

  const missingRequired = REQUIRED_FIELDS.filter(field => columnMap[field] === undefined);
  const cellAt = (row: string[], field: TsvFieldKey): string => {
    const idx = columnMap[field];
    if (idx === undefined) return '';
    return (row[idx] ?? '').trim();
  };

  const rows: ParsedTsvRow[] = [];
  const batchKeys = new Map<string, number>();
  let duplicateHints = 0;

  for (let i = dataStart; i < grid.length; i++) {
    const sourceLine = i + 1; // tokenizeTsv 输出与原始行号 1:1
    const rawRow = grid[i];
    if (isBlankRow(rawRow)) continue;

    const errors: string[] = [];
    const warnings: string[] = [];
    for (const field of missingRequired) {
      errors.push(`缺少「${FIELD_DISPLAY_NAME[field]}」列`);
    }

    const content = cellAt(rawRow, 'content');
    if (!missingRequired.includes('content') && content === '') {
      errors.push('专注事项不能为空');
    }

    const dateRaw = cellAt(rawRow, 'date');
    const ymd = normalizeDate(dateRaw);
    if (!missingRequired.includes('date') && !ymd) {
      errors.push(`日期「${dateRaw}」格式不正确`);
    }

    const startClock = parseClock(cellAt(rawRow, 'start'));
    const endClock = parseClock(cellAt(rawRow, 'end'));
    if (!missingRequired.includes('start') && !startClock) {
      errors.push(`开始时间「${cellAt(rawRow, 'start')}」格式不正确`);
    }
    if (!missingRequired.includes('end') && !endClock) {
      errors.push(`结束时间「${cellAt(rawRow, 'end')}」格式不正确`);
    }

    let startISO = '';
    let endISO = '';
    let actualSeconds: number | null = null;
    if (ymd && startClock && endClock) {
      startISO = toLocalISO(ymd, startClock);
      endISO = toLocalISO(ymd, endClock);
      const startMs = new Date(startISO).getTime();
      const endMs = new Date(endISO).getTime();
      actualSeconds = Math.floor((endMs - startMs) / 1000);
      if (endMs <= startMs) {
        errors.push('结束时间需晚于开始时间（跨天请拆成两条补录）');
      }
    }

    // 时长列：只做提示，永不阻断
    let durationSeconds: number | null = null;
    if (columnMap.duration !== undefined) {
      const durationRaw = cellAt(rawRow, 'duration');
      if (durationRaw) durationSeconds = parseDuration(durationRaw);
      if (durationRaw && durationSeconds === null) {
        warnings.push(`时长「${durationRaw}」无法识别，已按起止时间计算`);
      } else if (
        durationSeconds !== null &&
        actualSeconds !== null &&
        Math.abs(durationSeconds - actualSeconds) > 60
      ) {
        warnings.push(
          `标注时长 ${formatClockDuration(durationSeconds)} 与起止差 ${formatClockDuration(actualSeconds)} 不一致，以起止时间为准`,
        );
      }
    }

    // 疑似重复：纯提示，不改变 status
    if (startISO && endISO && content) {
      const key = buildTimeRecordKey(startISO, endISO, content);
      const batchLine = batchKeys.get(key);
      if (existingKeys.has(key)) {
        warnings.push('与已有记录疑似重复，仍将照常导入');
        duplicateHints++;
      } else if (batchLine !== undefined) {
        warnings.push(`与批内第 ${batchLine} 行疑似重复，仍将照常导入`);
        duplicateHints++;
      } else {
        batchKeys.set(key, sourceLine);
      }
    }

    rows.push({
      sourceLine,
      status: errors.length > 0 ? 'error' : 'valid',
      errors,
      warnings,
      date: ymd ?? '',
      startISO,
      endISO,
      content,
      note: cellAt(rawRow, 'note'),
      durationSeconds,
      actualSeconds,
    });
  }

  const valid = rows.filter(r => r.status === 'valid').length;
  return {
    rows,
    headerDetected,
    columnMap,
    ignoredBlankLines,
    summary: {
      total: rows.length,
      valid,
      error: rows.length - valid,
      duplicateHints,
    },
  };
}
