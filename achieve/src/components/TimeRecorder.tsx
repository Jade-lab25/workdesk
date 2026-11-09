import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TimeRecord } from '../types';
import { Clock, Play, Square, Calendar, StickyNote, Trash2, Plus, ClipboardPaste, AlertTriangle, CheckCircle2, XCircle, Info } from 'lucide-react';
import { parseTsv, buildTimeRecordKey } from '../utils/parseTsv';
import type { ManualTimeEntry } from '../utils/parseTsv';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

interface TimeRecorderProps {
  records: TimeRecord[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onStartTimer: (content: string) => string;
  onEndTimer: (recordId: string) => void;
  onDelete: (id: string) => void;
  onUpdateNote: (id: string, note: string) => void;
  onAddManual: (content: string, startTime: string, endTime: string) => void;
  onAddManualBatch: (entries: ManualTimeEntry[]) => void;
}

export function TimeRecorder({ records, selectedDate, onSelectDate, onStartTimer, onEndTimer, onDelete, onUpdateNote, onAddManual, onAddManualBatch }: TimeRecorderProps) {
  const [content, setContent] = useState('');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);

  // 手动补录弹窗
  const [showManual, setShowManual] = useState(false);
  const [mContent, setMContent] = useState('');
  const [mDate, setMDate] = useState('');
  const [mStart, setMStart] = useState('');
  const [mEnd, setMEnd] = useState('');

  // 粘贴 TSV 批量补录弹窗
  const [showPaste, setShowPaste] = useState(false);
  const [tsvText, setTsvText] = useState('');

  // 已有记录的重复键（全量，不限当天），仅用于生成疑似重复提示
  const existingKeys = useMemo(
    () => new Set(records
      .filter(r => r.endTime)
      .map(r => buildTimeRecordKey(r.startTime, r.endTime, r.content))),
    [records],
  );

  // 每次按键实时解析，空文本给 null（EMPTY 态）
  const pasteResult = useMemo(
    () => (tsvText.trim() === '' ? null : parseTsv(tsvText, { existingKeys })),
    [tsvText, existingKeys],
  );
  const pasteValidCount = pasteResult?.summary.valid ?? 0;
  const pasteErrorCount = pasteResult?.summary.error ?? 0;

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' | 'warning' = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const filteredRecords = records.filter(record => {
    const date = new Date(record.createdAt);
    const recordDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return recordDate === selectedDate;
  });

  // ✅ 从所有记录中找正在计时的，而不是只看当天的
  const currentRecording = records.find(r => !r.endTime) || null;

  // 每秒强制刷新，让列表中的计时器也能实时更新
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (currentRecording && currentRecording.startTimestamp) {
      const start = currentRecording.startTimestamp;
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } else if (recordingId) {
      interval = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [currentRecording, recordingId]);

  const handleStart = () => {
    if (content.trim()) {
      const id = onStartTimer(content.trim());
      setRecordingId(id);
      setElapsedTime(0);
      setContent('');
      addToast(`开始记录：${content.trim()}`, 'info');
    }
  };

  const handleEnd = () => {
    const id = currentRecording?.id || recordingId;
    if (id) {
      onEndTimer(id);
      addToast('计时结束，已保存', 'success');
      setRecordingId(null);
      setElapsedTime(0);
    }
  };

  const handleOpenNote = (record: TimeRecord) => {
    setNoteId(record.id);
    setNoteContent(record.note);
  };

  const handleSaveNote = () => {
    if (noteId) {
      onUpdateNote(noteId, noteContent);
      addToast('备注已保存', 'success');
      setNoteId(null);
      setNoteContent('');
    }
  };

  const toHM = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  const handleOpenManual = () => {
    const startD = new Date();
    const endD = new Date(startD.getTime() + 25 * 60 * 1000); // 默认一个番茄钟
    setMContent('');
    setMDate(selectedDate);
    setMStart(toHM(startD));
    setMEnd(toHM(endD));
    setShowManual(true);
  };

  const handleSaveManual = () => {
    if (!mContent.trim() || !mDate || !mStart || !mEnd) return;
    // 不带时区后缀的字符串按本地时区解析，与实时计时记录保持一致
    const startDate = new Date(`${mDate}T${mStart}:00`);
    const endDate = new Date(`${mDate}T${mEnd}:00`);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      addToast('时间格式不正确', 'error');
      return;
    }
    if (endDate.getTime() <= startDate.getTime()) {
      addToast('结束时间需晚于开始时间（跨天请拆成两条补录）', 'error');
      return;
    }
    onAddManual(mContent.trim(), startDate.toISOString(), endDate.toISOString());
    const seconds = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
    addToast(`已补录，时长 ${formatDuration(seconds)}`, 'success');
    setShowManual(false);
    onSelectDate(mDate); // 跳到补录日期，所见即所得
  };

  const handleOpenPaste = () => {
    setTsvText('');
    setShowPaste(true);
  };

  const handleConfirmPaste = () => {
    if (!pasteResult || pasteValidCount === 0) return;
    const validRows = pasteResult.rows.filter(r => r.status === 'valid');
    const entries: ManualTimeEntry[] = validRows.map(r => ({
      content: r.content,
      startTime: r.startISO,
      endTime: r.endISO,
      note: r.note,
    }));
    onAddManualBatch(entries);

    const dates = [...new Set(validRows.map(r => r.date))].sort();
    const msg = pasteErrorCount > 0
      ? `已批量补录 ${entries.length} 条，${pasteErrorCount} 行格式错误未导入`
      : `已批量补录 ${entries.length} 条`;
    addToast(msg, pasteErrorCount > 0 ? 'warning' : 'success');
    if (dates.length > 1) {
      addToast(`跨 ${dates.length} 天，已跳转至最早日期 ${dates[0]}`, 'info');
    }
    onSelectDate(dates[0]); // 跳到补录日期，所见即所得
    setShowPaste(false);
    setTsvText('');
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const formatDurationFromTime = (start: string, end: string) => {
    if (!end) return '00:00:00';
    try {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const totalSeconds = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
      return formatDuration(Math.max(0, totalSeconds));
    } catch {
      return '00:00:00';
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai'
    });
  };

  // 粘贴预览用：本地时区 ISO → HH:MM（与记录实际归属时区一致，不做 UTC 换算）
  const isoToHM = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const completedRecords = filteredRecords.filter(r => r.endTime);
  const totalSeconds = completedRecords.reduce((sum, record) => {
    if (!record.endTime) return sum;
    try {
      const startDate = new Date(record.startTime);
      const endDate = new Date(record.endTime);
      return sum + Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / 1000));
    } catch {
      return sum;
    }
  }, 0);

  const sortedRecords = [...filteredRecords].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const isRecording = !!currentRecording || !!recordingId;

  return (
    <>
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`fixed top-20 right-4 z-50 px-4 py-3 rounded-lg shadow-lg transition-all duration-300 ${
            toast.type === 'success' ? 'bg-green-50 border border-green-200' :
            toast.type === 'error' ? 'bg-red-50 border border-red-200' :
            toast.type === 'warning' ? 'bg-yellow-50 border border-yellow-200' :
            'bg-blue-50 border border-blue-200'
          }`}
        >
          <span className="text-gray-800 text-sm font-medium">{toast.message}</span>
        </div>
      ))}

      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Clock className="w-5 h-5 text-purple-500" />
            时间记录
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenManual}
              className="px-3 py-1.5 border border-purple-200 text-purple-600 rounded-lg text-sm hover:bg-purple-50 transition-colors flex items-center gap-1"
            >
              <Plus className="w-4 h-4" />
              手动补录
            </button>
            <button
              onClick={handleOpenPaste}
              className="px-3 py-1.5 border border-purple-200 text-purple-600 rounded-lg text-sm hover:bg-purple-50 transition-colors flex items-center gap-1"
            >
              <ClipboardPaste className="w-4 h-4" />
              粘贴补录
            </button>
            <Calendar className="w-4 h-4 text-gray-500" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onSelectDate(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="mb-4 p-4 bg-gray-50 rounded-xl">
          <h3 className="text-sm font-medium text-gray-600 mb-3">记录当前活动</h3>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="正在做什么..."
            rows={2}
            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none text-gray-800"
            disabled={isRecording}
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleStart}
              disabled={!content.trim() || isRecording}
              className="flex-1 py-3 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-4 h-4" />
              开始记录
            </button>
            <button
              onClick={handleEnd}
              disabled={!isRecording}
              className={`flex-1 py-3 text-white rounded-lg hover:opacity-90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                isRecording ? 'bg-red-500' : 'bg-gray-300'
              }`}
            >
              <Square className="w-4 h-4" />
              结束记录
            </button>
          </div>

          {currentRecording && (
            <div className="mt-4 text-center p-3 bg-red-50 rounded-lg border border-red-100">
              <p className="text-sm text-gray-600 flex items-center justify-center gap-2">
                <Clock className="w-4 h-4 text-red-500" />
                正在记录: {currentRecording.content}
              </p>
              <p className="text-2xl font-bold text-red-600 mt-2">
                {formatDuration(
                  currentRecording.startTimestamp
                    ? Math.floor((Date.now() - currentRecording.startTimestamp) / 1000)
                    : elapsedTime
                )}
              </p>
            </div>
          )}
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-600">今日时间记录</h3>
            <span className="text-sm text-gray-500">
              共 {completedRecords.length} 条记录 · 总时长: {formatDuration(totalSeconds)}
            </span>
          </div>

          <div className="space-y-3 max-h-64 overflow-y-auto">
            {sortedRecords.length === 0 ? (
              <p className="text-gray-400 text-center py-8">当日暂无时间记录</p>
            ) : (
              sortedRecords.map(record => {
                const isRunning = !record.endTime;
                const recordElapsedTime = isRunning && record.startTimestamp 
                  ? Math.floor((Date.now() - record.startTimestamp) / 1000) 
                  : 0;
                
                return (
                  <div
                    key={record.id}
                    className={`p-4 rounded-lg border ${
                      isRunning ? 'border-red-200 bg-red-50' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className={`font-medium ${isRunning ? 'text-red-600' : 'text-gray-800'}`}>
                          {record.content}
                        </h4>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-sm text-gray-500">
                            开始: {formatTime(record.createdAt)}
                          </span>
                          {!isRunning && record.endTime && (
                            <span className="text-sm text-gray-500">
                              结束: {formatTime(record.endTime)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-sm flex items-center gap-1 ${isRunning ? 'text-red-600' : 'text-purple-600'}`}>
                            <Clock className="w-4 h-4" />
                            时长: {isRunning ? formatDuration(recordElapsedTime) : formatDurationFromTime(record.startTime, record.endTime)}
                          </span>
                        </div>
                        {record.note && (
                          <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-100">
                            <p className="text-sm text-gray-700">{record.note}</p>
                          </div>
                        )}
                        {noteId === record.id && (
                          <div className="mt-2 p-2 bg-blue-50 rounded border border-blue-200">
                            <textarea
                              value={noteContent}
                              onChange={(e) => setNoteContent(e.target.value)}
                              placeholder="添加备注..."
                              rows={2}
                              className="w-full px-2 py-1 text-sm border-none bg-transparent focus:outline-none resize-none"
                            />
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={handleSaveNote}
                                className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => setNoteId(null)}
                                className="px-3 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                              >
                                取消
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        {record.endTime && (
                          <button
                            onClick={() => handleOpenNote(record)}
                            className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                            title="备注"
                          >
                            <StickyNote className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            onDelete(record.id);
                            addToast('记录已删除', 'info');
                          }}
                          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {showManual && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-purple-500" />
              手动补录时间
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">任务内容</label>
                <input
                  type="text"
                  value={mContent}
                  onChange={(e) => setMContent(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="完成了什么任务…"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">日期</label>
                <input
                  type="date"
                  value={mDate}
                  onChange={(e) => setMDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">开始时间</label>
                  <input
                    type="time"
                    value={mStart}
                    onChange={(e) => setMStart(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">结束时间</label>
                  <input
                    type="time"
                    value={mEnd}
                    onChange={(e) => setMEnd(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-400">仅支持同一天内的时间段；跨天的记录请拆成两条补录</p>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowManual(false)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSaveManual}
                disabled={!mContent.trim() || !mDate || !mStart || !mEnd}
                className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaste && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <ClipboardPaste className="w-5 h-5 text-purple-500" />
              粘贴补录时间记录
            </h3>

            <textarea
              value={tsvText}
              onChange={(e) => setTsvText(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono text-sm resize-y"
              placeholder={'日期\t开始时间\t结束时间\t时长\t专注事项\t进展记录\t分心次数\n2026-11-09\t11:20\t11:44\t23:40\t日常工作\t解决顺丰渠道问题\t-'}
              autoFocus
            />

            {pasteResult && !pasteResult.headerDetected && (
              <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700">未识别到表头，已按 日期 / 开始 / 结束 / 时长 / 事项 / 进展 / 分心 固定顺序解析</p>
              </div>
            )}

            {pasteResult && pasteResult.summary.total > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                <span>共 {pasteResult.summary.total} 行</span>
                <span className="text-green-600">可导入 {pasteValidCount}</span>
                {pasteErrorCount > 0 && <span className="text-red-600">格式错误 {pasteErrorCount}</span>}
                {pasteResult.summary.duplicateHints > 0 && (
                  <span className="flex items-center gap-1 text-gray-500">
                    <Info className="w-4 h-4" />
                    {pasteResult.summary.duplicateHints} 行疑似与已有记录重复，仍会照常导入
                  </span>
                )}
              </div>
            )}

            {pasteResult && pasteResult.summary.total === 0 && (
              <p className="mt-3 text-sm text-gray-400">仅识别到表头或空行，粘贴数据行后出现预览</p>
            )}

            {pasteResult && pasteResult.rows.length > 0 && (
              <div className="mt-3 border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium whitespace-nowrap">行号</th>
                      <th className="px-2 py-2 text-left font-medium whitespace-nowrap">日期</th>
                      <th className="px-2 py-2 text-left font-medium whitespace-nowrap">开始–结束</th>
                      <th className="px-2 py-2 text-left font-medium whitespace-nowrap">实际时长</th>
                      <th className="px-2 py-2 text-left font-medium">专注事项</th>
                      <th className="px-2 py-2 text-left font-medium">进展记录</th>
                      <th className="px-2 py-2 text-left font-medium whitespace-nowrap">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pasteResult.rows.map(row => {
                      const mismatch = row.durationSeconds !== null && row.actualSeconds !== null
                        && Math.abs(row.durationSeconds - row.actualSeconds) > 60;
                      return (
                        <tr key={row.sourceLine} className={row.status === 'error' ? 'bg-red-50/50' : ''}>
                          <td className="px-2 py-2 text-gray-400 whitespace-nowrap align-top">{row.sourceLine}</td>
                          <td className="px-2 py-2 whitespace-nowrap align-top">{row.date || '—'}</td>
                          <td className="px-2 py-2 whitespace-nowrap align-top">
                            {row.startISO ? `${isoToHM(row.startISO)}–${isoToHM(row.endISO)}` : '—'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap align-top">
                            {row.actualSeconds !== null && row.actualSeconds >= 0 ? (
                              mismatch ? (
                                <span className="text-amber-600">
                                  {formatDuration(row.actualSeconds)}
                                  <span className="block text-xs text-amber-500">
                                    （标注 {formatDuration(row.durationSeconds ?? 0)}）
                                  </span>
                                </span>
                              ) : formatDuration(row.actualSeconds)
                            ) : '—'}
                          </td>
                          <td className="px-2 py-2 text-gray-800 align-top">{row.content || '—'}</td>
                          <td className="px-2 py-2 text-gray-600 align-top">{row.note || '—'}</td>
                          <td className="px-2 py-2 whitespace-nowrap align-top">
                            {row.status === 'valid' ? (
                              <span className="flex items-center gap-1 text-green-600">
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                                可导入
                              </span>
                            ) : (
                              <span className="flex items-start gap-1 text-red-600">
                                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                <span className="text-xs">
                                  {row.errors.map(e => <span key={e} className="block">{e}</span>)}
                                </span>
                              </span>
                            )}
                            {row.warnings.length > 0 && (
                              <span className="block mt-1 text-xs text-amber-600">
                                {row.warnings.map(w => <span key={w} className="block">{w}</span>)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-3 mt-6 items-center">
              <button
                onClick={() => { setShowPaste(false); setTsvText(''); }}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmPaste}
                disabled={pasteValidCount === 0}
                className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                确认导入（{pasteValidCount} 条）
              </button>
            </div>
            {pasteErrorCount > 0 && (
              <p className="mt-2 text-right text-xs text-gray-400">{pasteErrorCount} 行格式错误，确认后不会导入</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}