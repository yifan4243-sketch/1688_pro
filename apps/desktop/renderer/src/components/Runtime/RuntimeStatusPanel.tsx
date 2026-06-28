import React from 'react';
import { RuntimeStatus, CliInfo, AccountInfo } from '../../services/api';

interface Props {
  runtime: RuntimeStatus | null;
  cliInfo: CliInfo | null;
  onRefresh: () => void;
  accounts?: AccountInfo[];
  activeProfile?: string;
}

const statusLabel: Record<string, string> = { logged_in: '已登录', not_logged_in: '未登录', login_opened: '待验证', verifying: '验证中', login_failed: '登录失败', busy: '占用中', profile_busy: '占用中', risk_control: '风控中', unknown: '未知' };
const statusKind: Record<string, string> = { logged_in: '', not_logged_in: 'warn', login_opened: 'neutral', verifying: 'neutral', login_failed: 'warn', busy: 'warn', profile_busy: 'warn', risk_control: 'warn', unknown: 'warn' };

export default function RuntimeStatusPanel({ runtime, cliInfo, onRefresh, accounts, activeProfile }: Props) {
  const daemonRunning = runtime?.daemon?.stdoutJson?.running === true;
  const activeAccount = accounts?.find((a) => a.profile === activeProfile);
  const accountStatus = activeAccount?.status || (runtime?.account?.stdoutJson?.loggedIn !== false ? 'logged_in' : 'not_logged_in');
  const nick = activeAccount?.alias || runtime?.account?.stdoutJson?.nick || null;

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
        <span className={`status-badge ${statusKind[accountStatus] || ''}`}>
          {statusLabel[accountStatus] || '未知'}
        </span>
      </div>
      <div className="status-line">
        <span className="status-key">Daemon</span>
        <span className={`status-badge ${daemonRunning ? '' : 'warn'}`}>
          {daemonRunning ? '运行中' : '未运行'}
        </span>
      </div>
      {activeProfile && (
        <div className="status-line">
          <span className="status-key">当前账号</span>
          <span className="status-val">{activeAccount?.alias || activeProfile}</span>
        </div>
      )}
      {nick && (
        <div className="status-line">
          <span className="status-key">会员</span>
          <span className="status-val">{nick}</span>
        </div>
      )}
      <button className="glass-btn-secondary" onClick={onRefresh} style={{ marginTop: 10, width: '100%' }}>
        刷新状态
      </button>
    </div>
  );
}
