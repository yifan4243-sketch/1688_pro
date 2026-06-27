import React from 'react';
import { createPortal } from 'react-dom';
import { CommandRecord } from '../../services/api';

function statusText(s: string): string {
  const map: Record<string, string> = { success: '成功', not_logged_in: '未登录', risk_control: '风控', profile_busy: '忙', network_error: '网络错误', cancelled: '已取消', failed: '失败', timeout: '超时' };
  return map[s] || s;
}

interface Props {
  title: string;
  history: CommandRecord[];
  open: boolean;
  onClose: () => void;
  onSelect: (record: CommandRecord) => void;
  compact?: boolean;
}

export default function HistoryModal({ title, history, open, onClose, onSelect, compact }: Props) {
  if (!open) return null;

  return createPortal(
    <div className="history-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`history-modal ${compact ? 'compact' : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
        </div>
        {history.length === 0 ? (
          <p className="muted-text">暂无记录。</p>
        ) : (
          history.map((item) => (
            <button key={item.runId} className="history-row" onClick={() => onSelect(item)}>
              <span className="history-command">{item.commandId}</span>
              <span className="history-status" style={{ color: item.status === 'success' ? '#16a34a' : item.status === 'failed' ? '#dc2626' : undefined }}>
                {statusText(item.status)}
              </span>
              <span className="history-time">{new Date(item.startedAt).toLocaleString()}</span>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}
