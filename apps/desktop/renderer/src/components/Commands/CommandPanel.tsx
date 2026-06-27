import React, { useState, useMemo } from 'react';
import { getApi, CommandRegistry, CommandDef, CommandPayload, CommandRecord, AccountData } from '../../services/api';

interface Props {
  registry: CommandRegistry;
  activeProfile: string;
  accounts: AccountData;
  onHistoryRefresh: () => void;
}

export default function CommandPanel({ registry, activeProfile, accounts, onHistoryRefresh }: Props) {
  const [activeGroup, setActiveGroup] = useState('sourcing');
  const [activeCmdId, setActiveCmdId] = useState('search');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [running, setRunning] = useState(false);
  const [lastRecord, setLastRecord] = useState<CommandRecord | null>(null);
  const [alert, setAlert] = useState<{ text: string; kind: string } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<CommandPayload | null>(null);

  const api = getApi();
  const command = registry.commands[activeCmdId];
  const groupCommands = Object.values(registry.commands).filter((c) => c.group === activeGroup);
  const activeAccount = accounts.accounts.find((a) => a.profile === activeProfile);
  const alias = activeAccount?.alias || activeProfile;

  const previewArgv = useMemo(() => {
    if (!command) return '';
    const parts = ['1688', ...command.argvPreview.split(' ').filter(Boolean)];
    for (const f of command.positional) {
      const v = args[f.name] || '';
      parts.push(...v.split(/[\r\n,]+/).filter(Boolean));
    }
    for (const o of command.options) {
      const v = options[o.name];
      if (o.type === 'boolean') { if (v) parts.push(o.flag); }
      else if (String(v ?? '').trim()) parts.push(o.flag, String(v).trim());
    }
    parts.push('--profile', activeProfile, '--json', '--pretty');
    return parts.join(' ');
  }, [command, args, options, activeProfile]);

  const chineseHint = useMemo(() => {
    if (activeCmdId === 'search') {
      const kw = args.keyword || '';
      if (!kw.trim()) return '请先填写搜索词。';
      return `当前任务：使用「${alias}」账号，在 1688 搜索"${kw}"，输出结构化数据。`;
    }
    if (activeCmdId === 'offer') {
      const ids = args.offerIds || '';
      if (!ids.trim()) return '请先填写 Offer ID。';
      return `当前任务：使用「${alias}」账号，采集商品详情：${ids.split(/[\r\n,]+/).filter(Boolean).join('、')}。`;
    }
    return `当前任务：使用「${alias}」账号执行「${command?.label || activeCmdId}」。`;
  }, [activeCmdId, args, alias, command]);

  const selectCommand = (id: string) => {
    setActiveCmdId(id);
    setArgs({});
    setOptions({});
    setLastRecord(null);
    setAlert(null);
    // Set defaults for non-boolean options
    const cmd = registry.commands[id];
    if (cmd) {
      const defs: Record<string, unknown> = {};
      for (const o of cmd.options) {
        if (o.type === 'boolean' && o.default) defs[o.name] = true;
        else if (o.default !== undefined && o.default !== '') defs[o.name] = o.default;
      }
      setOptions(defs);
    }
  };

  const collectPayload = (confirmed = false): CommandPayload => ({
    commandId: activeCmdId,
    args,
    options,
    profile: activeProfile,
    confirmed,
  });

  const runCommand = async (confirmed = false) => {
    if (command.write && !confirmed) {
      setPendingPayload(collectPayload(false));
      setShowConfirm(true);
      return;
    }
    setRunning(true);
    setAlert({ text: '命令执行中...', kind: 'info' });
    try {
      const record = await api.commands.run(collectPayload(confirmed));
      setLastRecord(record);
      if (record.status === 'success') {
        setAlert({ text: '执行成功', kind: 'success' });
      } else {
        setAlert({ text: record.error?.message || `执行失败: ${record.status}`, kind: 'error' });
      }
      onHistoryRefresh();
    } catch (e) {
      setAlert({ text: (e as Error).message, kind: 'error' });
    } finally {
      setRunning(false);
    }
  };

  const approveConfirm = () => {
    setShowConfirm(false);
    if (pendingPayload) runCommand(true);
  };

  const resultCount = useMemo(() => {
    if (!lastRecord) return '等待执行';
    const d = lastRecord.stdoutJson as Record<string, unknown> | undefined;
    if (d?.offers && Array.isArray(d.offers)) return `${d.offers.length} 个商品`;
    if (d?.items && Array.isArray(d.items)) return `${d.items.length} 条结果`;
    return '已执行';
  }, [lastRecord]);

  return (
    <section className="task-panel">
      <div className="section-head">
        <h3>命令面板</h3>
        <span>{chineseHint}</span>
      </div>

      {/* Group tabs */}
      <div className="group-tabs">
        {registry.groups.map((g) => (
          <button
            key={g.id}
            className={`nav-item ${g.id === activeGroup ? 'active' : ''}`}
            onClick={() => {
              setActiveGroup(g.id);
              const first = Object.values(registry.commands).find((c) => c.group === g.id);
              if (first) selectCommand(first.id);
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Command list */}
      <div className="command-list">
        {groupCommands.map((cmd) => (
          <button
            key={cmd.id}
            className={`command-item ${cmd.id === activeCmdId ? 'active' : ''}`}
            onClick={() => selectCommand(cmd.id)}
          >
            <strong>{cmd.label}</strong>
            <span>{cmd.argvPreview}</span>
            {cmd.write && <em>写操作</em>}
          </button>
        ))}
      </div>

      {/* Form */}
      {command && (
        <form className="command-form" onSubmit={(e) => { e.preventDefault(); runCommand(); }}>
          {command.positional.map((f) => (
            <label key={f.name} className="field">
              <span>{f.label}{f.required && ' *'}</span>
              {f.multiline || f.array ? (
                <textarea
                  rows={f.array ? 4 : 5}
                  value={args[f.name] || ''}
                  onChange={(e) => setArgs({ ...args, [f.name]: e.target.value })}
                />
              ) : (
                <input
                  type="text"
                  value={args[f.name] || ''}
                  onChange={(e) => setArgs({ ...args, [f.name]: e.target.value })}
                />
              )}
            </label>
          ))}

          {command.options.map((o) => {
            if (o.type === 'boolean') {
              return (
                <label key={o.name} className="toggle-row">
                  <input
                    type="checkbox"
                    checked={!!options[o.name]}
                    onChange={(e) => setOptions({ ...options, [o.name]: e.target.checked })}
                  />
                  <span>{o.label}</span>
                </label>
              );
            }
            if (o.type === 'select') {
              return (
                <label key={o.name} className="field">
                  <span>{o.label}</span>
                  <select
                    value={String(options[o.name] ?? o.default ?? '')}
                    onChange={(e) => setOptions({ ...options, [o.name]: e.target.value })}
                  >
                    {(o.values || []).map((v) => (
                      <option key={v.value} value={v.value}>{v.label}</option>
                    ))}
                  </select>
                </label>
              );
            }
            return (
              <label key={o.name} className="field">
                <span>{o.label}</span>
                <input
                  type={o.type === 'number' ? 'number' : 'text'}
                  value={String(options[o.name] ?? o.default ?? '')}
                  onChange={(e) => setOptions({ ...options, [o.name]: e.target.value })}
                />
              </label>
            );
          })}
        </form>
      )}

      {/* Run bar */}
      <div className="run-bar">
        <button className="primary-button" disabled={running} onClick={() => runCommand()}>
          {running ? '执行中...' : '执行命令'}
        </button>
        <button className="ghost-button" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '隐藏 CLI 预览' : '高级信息'}
        </button>
      </div>

      {showAdvanced && (
        <div className="command-preview">
          <span>CLI 预览</span>
          <code>{previewArgv}</code>
        </div>
      )}

      {alert && (
        <div className={`alert ${alert.kind}`}>{alert.text}</div>
      )}

      {/* Result count */}
      <p className="result-count">{resultCount}</p>

      {/* Quick result preview — full JSON, scrollable */}
      {lastRecord?.stdoutJson && (
        <div className="result-preview">
          <div className="result-actions">
            <button className="ghost-button" onClick={() => {
              const text = JSON.stringify(lastRecord.stdoutJson, null, 2);
              navigator.clipboard.writeText(text).then(
                () => setAlert({ text: '已复制完整 JSON', kind: 'success' }),
                () => setAlert({ text: '复制失败', kind: 'error' }),
              );
            }}>复制完整 JSON</button>
          </div>
          <pre className="json-output">{JSON.stringify(lastRecord.stdoutJson, null, 2)}</pre>
        </div>
      )}

      {/* Error detail for failed commands */}
      {lastRecord && lastRecord.status !== 'success' && (
        <div className="result-preview error-detail">
          <h4>错误详情</h4>
          <div className="error-grid">
            <div><span>状态</span><strong>{lastRecord.status}</strong></div>
            <div><span>退出码</span><strong>{lastRecord.exitCode ?? '-'}</strong></div>
            <div><span>错误信息</span><strong>{lastRecord.error?.message || lastRecord.stderrText || '-'}</strong></div>
          </div>
          {lastRecord.argv?.length > 0 && (
            <div className="error-argv">
              <span>CLI 命令</span>
              <code>{lastRecord.argv.join(' ')}</code>
            </div>
          )}
          {lastRecord.stderrText && (
            <div className="error-stderr">
              <span>stderr</span>
              <pre>{lastRecord.stderrText}</pre>
            </div>
          )}
        </div>
      )}

      {/* Confirm modal */}
      {showConfirm && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false); }}>
          <div className="modal">
            <h3>确认执行写操作</h3>
            <p>{command.checkoutConfirm ? '确认下单会提交真实 1688 订单。请确认已查看 checkout prepare 预览。' : '该命令会修改账号状态、发送消息或变更购物车。请确认目标和参数。'}</p>
            <code>{previewArgv}</code>
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowConfirm(false)}>取消</button>
              <button className="primary-button danger" onClick={approveConfirm}>确认执行</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
