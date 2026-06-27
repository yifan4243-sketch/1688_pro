import React from 'react';
import { CommandRecord } from '../../services/api';

interface Props {
  history: CommandRecord[];
}

function statusText(s: string) {
  const map: Record<string, string> = {
    success: '成功',
    not_logged_in: '未登录',
    risk_control: '风控',
    profile_busy: '忙',
    network_error: '网络错误',
    cancelled: '已取消',
    failed: '失败',
  };
  return map[s] || s;
}

export default function HistoryPanel({ history }: Props) {
  if (!history.length) {
    return (
      <section className="capability-panel">
        <h4>最近任务</h4>
        <p className="muted-text">暂无历史。</p>
      </section>
    );
  }

  return (
    <section className="capability-panel">
      <h4>最近任务</h4>
      {history.slice(0, 8).map((item) => (
        <div key={item.runId} className="history-item">
          <strong>{item.commandId}</strong>
          <span>{statusText(item.status)} · {new Date(item.startedAt).toLocaleString()}</span>
        </div>
      ))}
    </section>
  );
}
