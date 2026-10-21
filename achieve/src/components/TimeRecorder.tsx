import { useState, useEffect, useCallback } from 'react';
import type { TimeRecord } from '../types';
import { Clock, Play, Square, Calendar, StickyNote, Trash2, Plus } from 'lucide-react';

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
}

export function TimeRecorder({ records, selectedDate, onSelectDate, onStartTimer, onEndTimer, onDelete, onUpdateNote, onAddManual }: TimeRecorderProps) {
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
    </>
  );
}