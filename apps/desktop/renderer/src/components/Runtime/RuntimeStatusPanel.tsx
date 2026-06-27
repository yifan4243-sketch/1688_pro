import React from 'react';
import { RuntimeStatus, CliInfo } from '../../services/api';

interface Props {
  runtime: RuntimeStatus | null;
  cliInfo: CliInfo | null;
  onRefresh: () => void;
}

export default function RuntimeStatusPanel({ runtime, cliInfo, onRefresh }: Props) {
  const daemonRunning = runtime?.daemon?.stdoutJson?.running === true;
  const loggedIn = runtime?.account?.stdoutJson?.loggedIn !== false;
  const nick = runtime?.account?.stdoutJson?.nick || null;

  return (
    <div className="glass-panel-card">
      <h2>运行状态</h2>

      <div className="status-line">
        <span className="status-key">CLI</span>
        <span className={`status-badge ${cliInfo?.cliExists !== false ? '' : 'warn'}`}>
          {cliInfo?.isPackaged ? '内置引擎' : '开发模式'}
        </span>
      </div>

      <div className="status-line">
        <span className="status-key">1688账号</span>
        <span className={`status-badge ${loggedIn ? '' : 'warn'}`}>
          {loggedIn ? '已登录' : '未登录'}
        </span>
      </div>

      <div className="status-line">
        <span className="status-key">Daemon</span>
        <span className={`status-badge ${daemonRunning ? '' : 'warn'}`}>
          {daemonRunning ? '运行中' : '未运行'}
        </span>
      </div>

      {nick && (
        <div className="status-line">
          <span className="status-key">账号</span>
          <span className="status-val">{nick}</span>
        </div>
      )}

      <button className="glass-btn-secondary" onClick={onRefresh} style={{ marginTop: 10, width: '100%' }}>
        刷新状态
      </button>
    </div>
  );
}
