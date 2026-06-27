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

  return (
    <section className="status-panel">
      <h2>运行状态</h2>

      <div className="status-row">
        <span>CLI</span>
        <strong className={cliInfo?.cliExists !== false ? '' : 'warn'}>
          {cliInfo?.isPackaged ? '内置引擎' : '开发模式'}
        </strong>
      </div>

      <div className="status-row">
        <span>1688账号</span>
        <strong className={loggedIn ? '' : 'warn'}>
          {loggedIn ? '已登录' : '未登录'}
        </strong>
        {!loggedIn && <span className="hint">请点击"登录 / 重新登录"</span>}
      </div>

      <div className="status-row">
        <span>Daemon</span>
        <strong className={daemonRunning ? '' : 'warn'}>
          {runtime?.daemon === null ? '检测中' : daemonRunning ? '运行中' : '未运行'}
        </strong>
      </div>

      {runtime?.account?.stdoutJson && (
        <div className="status-detail">
          {runtime.account.stdoutJson.nick && (
            <div className="status-row"><span>账号</span><strong>{runtime.account.stdoutJson.nick}</strong></div>
          )}
        </div>
      )}

      <button className="ghost-button" onClick={onRefresh} style={{ marginTop: 8 }}>
        刷新状态
      </button>
    </section>
  );
}
