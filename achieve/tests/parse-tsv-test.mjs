import assert from 'node:assert/strict';
import { tokenizeTsv, parseTsv, buildTimeRecordKey } from '../src/utils/parseTsv.ts';

// ① 用户真实样本：3 行全 valid；rest 原样导入；分心列无痕；空进展 note=''
//    注意首行标注 23:40 与起止实际差 24:00 相差 20 秒，按口径不得告警
const sample = [
  '日期\t开始时间\t结束时间\t时长\t专注事项\t进展记录\t分心次数',
  '2026-11-09\t11:20\t11:44\t23:40\t日常工作\t解决顺丰201渠道停用问题\t-',
  '2026-11-09\t10:01\t10:16\t15:00\trest\t\t-',
  '2026-11-09\t09:46\t10:01\t15:01\trest\t\t-',
].join('\n');

const sampleResult = parseTsv(sample);
assert.equal(sampleResult.headerDetected, true, 'sample header must be detected');
assert.equal(sampleResult.rows.length, 3, 'sample must yield 3 rows');
assert.deepEqual(sampleResult.summary, { total: 3, valid: 3, error: 0, duplicateHints: 0 });
assert.equal(sampleResult.rows[0].content, '日常工作');
assert.equal(sampleResult.rows[0].note, '解决顺丰201渠道停用问题');
assert.equal(sampleResult.rows[1].content, 'rest', 'rest rows are imported verbatim, no content-based filtering');
assert.equal(sampleResult.rows[1].note, '', 'empty progress cell becomes empty string');
assert.equal(sampleResult.rows[2].content, 'rest');
for (const row of sampleResult.rows) {
  assert.equal('distraction' in row, false, 'distraction column must leave no field on the row');
  assert.ok(!JSON.stringify(row).includes('分心'), 'distraction header text must not leak into row data');
  assert.equal(row.warnings.length, 0, '20s duration gap is within tolerance; no warning on the real sample');
}
// 本地分量断言（不断言 Z 偏移，换时区也成立）
const firstStart = new Date(sampleResult.rows[0].startISO);
assert.equal(firstStart.getHours(), 11);
assert.equal(firstStart.getMinutes(), 20);
const firstEnd = new Date(sampleResult.rows[0].endISO);
assert.equal(firstEnd.getHours(), 11);
assert.equal(firstEnd.getMinutes(), 44);
assert.equal(sampleResult.rows[0].durationSeconds, 1420, '23:40 parses as 1420 seconds');
assert.equal(sampleResult.rows[0].actualSeconds, 1440, '11:20→11:44 actual gap is 1440 seconds');
assert.equal(sampleResult.rows[0].sourceLine, 2, 'first data row under a header is source line 2');

// ② 无表头回退：按固定 7 列位置解析，挂 headerDetected=false
const noHeader = [
  '2026-11-09\t11:20\t11:44\t23:40\t日常工作\t进展A\t-',
  '2026-11-09\t10:01\t10:16\t15:00\trest\t\t-',
].join('\n');
const fallbackResult = parseTsv(noHeader);
assert.equal(fallbackResult.headerDetected, false);
assert.equal(fallbackResult.rows.length, 2);
assert.equal(fallbackResult.rows[0].status, 'valid');
assert.equal(fallbackResult.rows[0].content, '日常工作');
assert.equal(fallbackResult.rows[0].note, '进展A');
assert.equal(fallbackResult.columnMap.content, 4, 'fallback maps content to fixed position 4');

// ③ 乱序列名 + 别名：按列名建索引而非位置
const shuffled = [
  '内容\t日期\t结束时间\t开始时间\t备注',
  '写周报\t2026-11-09\t10:30\t10:00\t周报已发',
].join('\n');
const shuffledResult = parseTsv(shuffled);
assert.equal(shuffledResult.headerDetected, true);
assert.equal(shuffledResult.rows[0].content, '写周报');
assert.equal(shuffledResult.rows[0].date, '2026-11-09');
assert.equal(shuffledResult.rows[0].note, '周报已发');
assert.equal(new Date(shuffledResult.rows[0].startISO).getHours(), 10);
assert.equal(new Date(shuffledResult.rows[0].endISO).getHours(), 10);
assert.equal(new Date(shuffledResult.rows[0].endISO).getMinutes(), 30);

// ④ 缺必填列 → 每行结构性 error；短行缺单元格 → 事项不能为空
const missingCol = parseTsv(['日期\t开始时间', '2026-11-09\t10:00'].join('\n'));
assert.equal(missingCol.headerDetected, true, 'two alias hits still count as a header');
assert.equal(missingCol.rows[0].status, 'error');
assert.ok(missingCol.rows[0].errors.some(e => e.includes('缺少「结束时间」列')));
assert.ok(missingCol.rows[0].errors.some(e => e.includes('缺少「专注事项」列')));
const shortRow = parseTsv(
  ['日期\t开始时间\t结束时间\t时长\t专注事项\t进展记录\t分心次数', '2026-11-09\t10:00\t10:30'].join('\n'),
);
assert.equal(shortRow.rows[0].status, 'error');
assert.ok(shortRow.rows[0].errors.includes('专注事项不能为空'));

// ⑤ 坏行行级隔离：中间一行坏，前后好行照导
const isolation = parseTsv([
  '日期\t开始时间\t结束时间\t专注事项',
  '2026-11-09\t09:00\t09:30\t任务A',
  '2026-13-01\t10:00\t10:30\t任务B',
  '2026-11-09\t11:00\t11:30\t任务C',
].join('\n'));
assert.deepEqual(
  isolation.rows.map(r => r.status),
  ['valid', 'error', 'valid'],
);
assert.equal(isolation.summary.valid, 2);
assert.equal(isolation.summary.error, 1);
assert.ok(isolation.rows[1].errors[0].includes('格式不正确'));

// ⑥ 引号：内含 Tab、换行、"" 转义
const quoted = parseTsv([
  '日期\t开始时间\t结束时间\t专注事项\t进展记录',
  '2026-11-09\t10:00\t11:00\t"多\t字"\t"第一行\n第二行"',
  '2026-11-09\t12:00\t13:00\t"他说""好"""\t',
].join('\n'));
assert.equal(quoted.rows[0].content, '多\t字', 'tab inside quotes is cell content');
assert.equal(quoted.rows[0].note, '第一行\n第二行', 'newline inside quotes is cell content');
assert.equal(quoted.rows[1].content, '他说"好"', 'doubled quotes unescape to one quote');
assert.equal(quoted.rows.length, 2, 'embedded newline must not create an extra row');
// 未闭合引号也不许抛异常
assert.doesNotThrow(() => tokenizeTsv('"unterminated quote'));

// ⑦ CRLF + BOM + 空行
const bom = '﻿';
const crlf = [
  `${bom}日期\t开始时间\t结束时间\t专注事项`,
  '',
  '2026-11-09\t10:00\t10:30\t任务A',
  '',
  '2026-11-09\t11:00\t11:30\t任务B',
  '',
].join('\r\n');
const crlfResult = parseTsv(crlf);
assert.equal(crlfResult.headerDetected, true, 'BOM must be stripped before header matching');
assert.equal(crlfResult.rows.length, 2);
// 结尾换行不产生尾空行，只有两条中间空行被计数
assert.equal(crlfResult.ignoredBlankLines, 2);
assert.equal(crlfResult.rows[0].content, '任务A');

// ⑧ 全角：时间类字段转半角；自由文本原样保留
const fullWidth = parseTsv([
  '日期\t开始时间\t结束时间\t专注事项',
  '２０２６-11-09\t１１:２０\t１１：４４\t会议：复盘',
].join('\n'));
assert.equal(fullWidth.rows[0].status, 'valid', JSON.stringify(fullWidth.rows[0].errors));
assert.equal(fullWidth.rows[0].date, '2026-11-09');
assert.equal(new Date(fullWidth.rows[0].startISO).getHours(), 11);
assert.equal(new Date(fullWidth.rows[0].endISO).getMinutes(), 44);
assert.equal(fullWidth.rows[0].content, '会议：复盘', 'content text must keep full-width characters verbatim');

// ⑨ H:MM 与 HH:MM:SS（无表头回退：第 4 列是时长，事项在第 5 列）
const secondsRow = parseTsv('2026-11-09\t9:46\t10:01:30\t15:00\t任务').rows[0];
assert.equal(secondsRow.status, 'valid');
assert.equal(new Date(secondsRow.startISO).getHours(), 9);
assert.equal(new Date(secondsRow.startISO).getMinutes(), 46);
assert.equal(new Date(secondsRow.endISO).getSeconds(), 30);
assert.equal(secondsRow.actualSeconds, 930, '09:46:00 → 10:01:30 = 930 seconds');

// ⑩ 时长 warning 三阈值 + 无法识别 + 纯数字分钟
const head = '日期\t开始时间\t结束时间\t时长\t专注事项';
const equalRow = parseTsv(`${head}\n2026-11-09\t10:00\t10:15\t15:00\tA`).rows[0];
assert.equal(equalRow.warnings.length, 0, 'exact match: no warning');
const gap20 = parseTsv(`${head}\n2026-11-09\t10:00\t10:15\t14:40\tA`).rows[0];
assert.equal(gap20.warnings.length, 0, '20 second gap: no warning');
const gap61 = parseTsv(`${head}\n2026-11-09\t10:00\t10:15\t13:59\tA`).rows[0];
assert.equal(gap61.warnings.length, 1);
assert.ok(gap61.warnings[0].includes('不一致'), '>60s gap warns and says start/end win');
const badDuration = parseTsv(`${head}\n2026-11-09\t10:00\t10:15\t未知\tA`).rows[0];
assert.ok(badDuration.warnings[0].includes('无法识别'));
assert.equal(badDuration.status, 'valid', 'duration problems never block import');
const numericDuration = parseTsv(`${head}\n2026-11-09\t10:00\t10:15\t15\tA`).rows[0];
assert.equal(numericDuration.durationSeconds, 900, 'plain number is minutes');

// ⑪ end ≤ start：等于和倒置都报错，文案沿用手动弹窗原句
const endBefore = parseTsv('2026-11-09\t11:00\t10:00\t60:00\tA').rows[0];
const endEqual = parseTsv('2026-11-09\t10:00\t10:00\t00:00\tA').rows[0];
for (const row of [endBefore, endEqual]) {
  assert.equal(row.status, 'error');
  assert.ok(row.errors.includes('结束时间需晚于开始时间（跨天请拆成两条补录）'));
}

// ⑫ 非法日期：日历回环拦截，闰日校验
for (const bad of ['2026-02-30', '2026-13-01', '2026-02-29']) {
  const row = parseTsv(`${bad}\t10:00\t10:30\t30:00\tA`).rows[0];
  assert.equal(row.status, 'error', `${bad} must be rejected`);
  assert.ok(row.errors.some(e => e.includes('格式不正确')), `${bad} error mentions format`);
}
const leap = parseTsv('2024-02-29\t10:00\t10:30\t30:00\tA').rows[0];
assert.equal(leap.status, 'valid', '2024 is a leap year');

// ⑬ 四种日期格式归一
for (const raw of ['2026-11-09', '2026/11/9', '2026.11.9', '2026年11月9日']) {
  const row = parseTsv(`${raw}\t10:00\t10:30\t30:00\tA`).rows[0];
  assert.equal(row.date, '2026-11-09', `${raw} normalizes to ISO date`);
}

// ⑭ 空串 / 纯空白 / 纯表头 / 单行无表头
assert.deepEqual(parseTsv('').summary, { total: 0, valid: 0, error: 0, duplicateHints: 0 });
assert.equal(parseTsv('   \n\n').rows.length, 0);
const headerOnly = parseTsv('日期\t开始时间\t结束时间\t专注事项');
assert.equal(headerOnly.headerDetected, true);
assert.equal(headerOnly.summary.total, 0);
const single = parseTsv('2026-11-09\t10:00\t10:30\t30:00\t单飞');
assert.equal(single.headerDetected, false);
assert.equal(single.summary.valid, 1);

// ⑮ 重复只警告不降级：existingKeys 命中 + 批内重复
const dupText = [
  '日期\t开始时间\t结束时间\t专注事项',
  '2026-11-09\t10:00\t10:30\t重复任务',
  '2026-11-09\t10:00\t10:30\t重复任务',
].join('\n');
const firstParse = parseTsv(dupText);
assert.equal(firstParse.rows[1].status, 'valid', 'in-batch duplicate stays importable');
assert.ok(firstParse.rows[1].warnings[0].includes('与批内第 2 行疑似重复'));
assert.equal(firstParse.summary.duplicateHints, 1);
const existing = new Set([
  buildTimeRecordKey(firstParse.rows[0].startISO, firstParse.rows[0].endISO, ' 重复任务 '),
]);
const secondParse = parseTsv(dupText, { existingKeys: existing });
assert.ok(secondParse.rows[0].warnings.includes('与已有记录疑似重复，仍将照常导入'));
assert.equal(secondParse.rows[0].status, 'valid');
assert.equal(secondParse.summary.valid, 2);

// ⑯ 进展记录多行文本：结果仍是一行，note 内含换行
const multiline = parseTsv(
  '日期\t开始时间\t结束时间\t专注事项\t进展记录\n2026-11-09\t10:00\t11:00\tA\t"行1\n行2\n行3"',
);
assert.equal(multiline.rows.length, 1);
assert.equal(multiline.rows[0].note, '行1\n行2\n行3');

// ⑰ buildTimeRecordKey：稳定、trim 内容、不同内容不同键
const k1 = buildTimeRecordKey('2026-11-09T02:00:00.000Z', '2026-11-09T02:30:00.000Z', ' 写周报 ');
const k2 = buildTimeRecordKey('2026-11-09T02:00:00.000Z', '2026-11-09T02:30:00.000Z', '写周报');
const k3 = buildTimeRecordKey('2026-11-09T02:00:00.000Z', '2026-11-09T02:30:00.000Z', '写日报');
assert.equal(k1, k2, 'content is trimmed inside the key');
assert.notEqual(k1, k3);
assert.equal(k1, buildTimeRecordKey('2026-11-09T02:00:00.000Z', '2026-11-09T02:30:00.000Z', '写周报'));

// ⑱ 输入不可变 + 200 行压力
const keys = new Set(['keep-me']);
const beforeSize = keys.size;
parseTsv(sample, { existingKeys: keys });
assert.equal(keys.size, beforeSize, 'parser must not mutate the existingKeys set');
assert.ok(keys.has('keep-me'));
const stressRows = [];
for (let i = 0; i < 200; i++) {
  const h = String(Math.floor(i / 20)).padStart(2, '0');
  const m = String((i % 20) * 3).padStart(2, '0');
  const mEnd = String((i % 20) * 3 + 2).padStart(2, '0');
  stressRows.push(`2026-11-09\t${h}:${m}\t${h}:${mEnd}\t2:00\t任务${i}`);
}
const stress = parseTsv(stressRows.join('\n'));
assert.equal(stress.summary.total, 200);
assert.equal(stress.summary.valid, 200);
assert.equal(stress.summary.error, 0);
assert.equal(new Set(stress.rows.map(r => r.startISO)).size, 200, 'all 200 start times stay distinct');

console.log('parse TSV tests passed (18 groups)');
