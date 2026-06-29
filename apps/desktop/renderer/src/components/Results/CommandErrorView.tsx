import React from 'react';
import type { CommandRecord } from '../../services/api';
import { formatCommandError } from './errorFormatter';

type CommandErrorViewProps = {
  record?: CommandRecord | null;
  command?: string;
  status?: unknown;
  exitCode?: unknown;
  message?: unknown;
  stderr?: unknown;
  stdout?: unknown;
  context?: 'search' | 'offer' | 'ozon' | 'unknown';
};

const levelBorder: Record<string, string> = {
  error: 'rgba(239,68,68,0.24)',
  warn: 'rgba(245,158,11,0.28)',
  info: 'rgba(59,130,246,0.20)',
};

const levelBg: Record<string, string> = {
  error: 'rgba(254,242,242,0.82)',
  warn: 'rgba(255,251,235,0.82)',
  info: 'rgba(239,246,255,0.82)',
};

export default function CommandErrorView({
  record,
  command,
  status,
  exitCode,
  message,
  stderr,
  stdout,
  context,
}: CommandErrorViewProps) {
  const friendly = formatCommandError({
    status: status ?? record?.status,
    code: record?.error?.status ?? '',
    message: message ?? record?.error?.message ?? record?.stderrText,
    stderr: stderr ?? record?.stderrText,
    stdout: stdout ?? (record?.stdoutJson != null ? JSON.stringify(record.stdoutJson) : undefined),
    exitCode: exitCode ?? record?.exitCode,
    command: command ?? record?.commandId,
    context: context ?? (record?.commandId === 'offer' ? 'offer' : record?.commandId === 'generateOzonDraft' ? 'ozon' : 'search'),
  });

  const border = levelBorder[friendly.level] || levelBorder.error;
  const bg = levelBg[friendly.level] || levelBg.error;

  const statusLabel = String(status ?? record?.status ?? '-');

  return (
    <div className="command-error-card" style={{ borderColor: border, background: bg }}>
      {/* ── Main error summary ── */}
      <div className="command-error-header">
        <h3 className="command-error-title">{friendly.title}</h3>
        <p className="command-error-summary">{friendly.summary}</p>
      </div>

      {friendly.reason && (
        <div className="command-error-reason">
          <span className="command-error-label">可能原因：</span>
          <span>{friendly.reason}</span>
        </div>
      )}

      {friendly.advice.length > 0 && (
        <div className="command-error-advice">
          <span className="command-error-label">建议操作：</span>
          <ol className="command-error-advice-list">
            {friendly.advice.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </div>
      )}

      {/* ── Meta line ── */}
      <div className="command-error-meta">
        <span className="command-error-meta-item">
          状态：<strong>{statusLabel}</strong>
        </span>
        {friendly.exitCode != null && (
          <span className="command-error-meta-item">
            退出码：<strong>{friendly.exitCode}</strong>
          </span>
        )}
        {friendly.technicalCode && (
          <span className="command-error-meta-item">
            错误代码：<strong>{friendly.technicalCode}</strong>
          </span>
        )}
      </div>

      {/* ── Technical details (collapsed) ── */}
      <details className="command-error-technical">
        <summary className="command-error-technical-summary">技术详情 / 调试信息</summary>
        <div className="command-error-technical-body">
          {record?.runId && (
            <div className="command-error-tech-row">
              <span>Run ID</span>
              <code>{record.runId}</code>
            </div>
          )}

          {record?.argv && record.argv.length > 0 && (
            <div className="command-error-tech-row">
              <span>CLI 命令</span>
              <code>{record.argv.join(' ')}</code>
            </div>
          )}

          {record?.stderrText && (
            <div className="command-error-tech-row">
              <span>stderr</span>
              <pre>{tryPrettyPrint(record.stderrText)}</pre>
            </div>
          )}

          {record?.stdoutJson != null && record.status !== 'success' && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 11, cursor: 'pointer', color: '#64748b' }}>stdout JSON（原始输出）</summary>
              <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: 11, marginTop: 4 }}>
                {JSON.stringify(record.stdoutJson, null, 2)}
              </pre>
            </details>
          )}

          {record?.error && (
            <div className="command-error-tech-row">
              <span>原始错误对象</span>
              <pre>{JSON.stringify(record.error, null, 2)}</pre>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function tryPrettyPrint(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}
