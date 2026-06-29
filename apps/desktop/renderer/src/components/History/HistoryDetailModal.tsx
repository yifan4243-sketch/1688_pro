import React from 'react';
import { createPortal } from 'react-dom';
import { CommandRecord } from '../../services/api';
import CommandErrorView from '../Results/CommandErrorView';

function statusText(s: string): string {
  const map: Record<string, string> = { success: '成功', not_logged_in: '未登录', risk_control: '风控', profile_busy: '忙', network_error: '网络错误', cancelled: '已取消', failed: '失败', timeout: '超时' };
  return map[s] || s;
}

interface Props {
  record: CommandRecord | null;
  onClose: () => void;
}

export default function HistoryDetailModal({ record, onClose }: Props) {
  if (!record) return null;

  const startedMs = new Date(record.startedAt).getTime();
  const endedMs = record.endedAt ? new Date(record.endedAt).getTime() : Date.now();
  const durationMs = record.durationMs ?? (endedMs - startedMs);

  const isFailure = record.status !== 'success' && record.status !== 'running';

  return createPortal(
    <div className="history-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="history-modal">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>任务详情</h3>
          <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
        </div>

        <div className="history-detail-grid">
          <span className="detail-key">命令</span>
          <span className="detail-val"><strong>{record.commandId}</strong></span>
          <span className="detail-key">状态</span>
          <span className="detail-val" style={{ color: record.status === 'success' ? '#16a34a' : '#dc2626' }}>{statusText(record.status)}</span>
          <span className="detail-key">Profile</span>
          <span className="detail-val">{record.profile || '-'}</span>
          <span className="detail-key">开始时间</span>
          <span className="detail-val">{new Date(record.startedAt).toLocaleString()}</span>
          {record.endedAt && (
            <>
              <span className="detail-key">结束时间</span>
              <span className="detail-val">{new Date(record.endedAt).toLocaleString()}</span>
            </>
          )}
          <span className="detail-key">耗时</span>
          <span className="detail-val">{(durationMs / 1000).toFixed(1)}s</span>
        </div>

        {/* Chinese-friendly error block for failed records */}
        {isFailure && (
          <CommandErrorView record={record} />
        )}

        {record.argv?.length > 0 && (
          <details className="advanced-section" style={{ marginTop: 12 }}>
            <summary className="advanced-toggle">CLI 命令</summary>
            <code style={{ fontSize: 12, wordBreak: 'break-all', display: 'block', marginTop: 6 }}>{record.argv.join(' ')}</code>
          </details>
        )}

        {record.stdoutJson != null && (
          <details className="advanced-section" style={{ marginTop: 8 }}>
            <summary className="advanced-toggle">输出 JSON</summary>
            <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 11, marginTop: 6 }}>{JSON.stringify(record.stdoutJson, null, 2)}</pre>
          </details>
        )}

        {record.stderrText && (
          <details className="advanced-section" style={{ marginTop: 8 }}>
            <summary className="advanced-toggle">stderr 日志</summary>
            <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: 11, marginTop: 6, whiteSpace: 'pre-wrap' }}>{record.stderrText}</pre>
          </details>
        )}

        {record.error && (
          <div className="detail-failure" style={{ marginTop: 12 }}>
            <p><strong>错误</strong></p>
            <p>{record.error.message || JSON.stringify(record.error)}</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
