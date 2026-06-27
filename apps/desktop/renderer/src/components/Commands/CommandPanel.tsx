import React, { useState, useMemo } from 'react';
import { getApi, CommandRegistry, CommandDef, CommandPayload, CommandRecord, AccountData } from '../../services/api';
import ResultRenderer from '../Results/ResultRenderer';
import '../../components/Results/results.css';

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

      {/* Group tabs — segmented control */}
      <div className="segmented-control">
        {registry.groups.map((g) => (
          <button
            key={g.id}
            className={`seg-btn ${g.id === activeGroup ? 'active' : ''}`}
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

      {/* Command picker */}
      <div className="form-field">
        <label className="form-label">任务类型</label>
        <select
          className="glass-select"
          value={activeCmdId}
          onChange={(e) => selectCommand(e.target.value)}
        >
          {groupCommands.map((cmd) => (
            <option key={cmd.id} value={cmd.id}>
              {cmd.label} · {cmd.id}
            </option>
          ))}
        </select>
      </div>

      {/* Form */}
      {command && (
        <form onSubmit={(e) => { e.preventDefault(); runCommand(); }}>
          <div className="glass-section">
            {command.positional.map((f) => (
              <div key={f.name} className="form-field">
                <label className="form-label">{f.label}{f.required && <span className="required">*</span>}</label>
                {f.multiline || f.array ? (
                  <textarea
                    className="glass-textarea"
                    rows={f.array ? 4 : 5}
                    value={args[f.name] || ''}
                    onChange={(e) => setArgs({ ...args, [f.name]: e.target.value })}
                />
              ) : (
                <input className="glass-input" type="text"
                  value={args[f.name] || ''}
                  onChange={(e) => setArgs({ ...args, [f.name]: e.target.value })}
                />
              )}
              </div>
            ))}
          </div>

          <div className="glass-section">
            {command.options.map((o) => {
              if (o.type === 'boolean') {
                return (
                  <label key={o.name} className="toggle-row">
                    <input type="checkbox"
                      checked={!!options[o.name]}
                      onChange={(e) => setOptions({ ...options, [o.name]: e.target.checked })}
                    />
                    <span>{o.label}</span>
                  </label>
                );
              }
              if (o.type === 'select') {
                return (
                  <div key={o.name} className="form-field">
                    <label className="form-label">{o.label}</label>
                    <select className="glass-select"
                      value={String(options[o.name] ?? o.default ?? '')}
                      onChange={(e) => setOptions({ ...options, [o.name]: e.target.value })}
                    >
                      {(o.values || []).map((v) => (
                        <option key={v.value} value={v.value}>{v.label}</option>
                      ))}
                    </select>
                  </div>
                );
              }
              return (
                <div key={o.name} className="form-field">
                  <label className="form-label">{o.label}</label>
                  <input className="glass-input"
                    type={o.type === 'number' ? 'number' : 'text'}
                    value={String(options[o.name] ?? o.default ?? '')}
                    onChange={(e) => setOptions({ ...options, [o.name]: e.target.value })}
                  />
                </div>
              );
            })}
          </div>
        </form>
      )}

      {/* Run bar */}
      <div className="run-bar">
        <button className="glass-btn-primary" disabled={running} onClick={() => runCommand()}>
          {running ? '执行中...' : '执行命令'}
        </button>
        <button className="glass-btn-ghost" onClick={() => setShowAdvanced(!showAdvanced)}>
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

      {/* Result renderer: card / JSON toggle, full display */}
      {lastRecord && (
        <ResultRenderer record={lastRecord} resultType={command.resultType} />
      )}

      {/* Confirm modal */}
      {showConfirm && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false); }}>
          <div className="modal">
            <h3>确认执行写操作</h3>
            <p>{command.checkoutConfirm ? '确认下单会提交真实 1688 订单。请确认已查看 checkout prepare 预览。' : '该命令会修改账号状态、发送消息或变更购物车。请确认目标和参数。'}</p>
            <code>{previewArgv}</code>
            <div className="modal-actions">
              <button className="glass-btn-ghost" onClick={() => setShowConfirm(false)}>取消</button>
              <button className="glass-btn-primary" style={{background: 'linear-gradient(135deg, rgba(220,38,38,0.92), rgba(200,30,30,0.88))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28), 0 12px 28px rgba(220,38,38,0.22)'}} onClick={approveConfirm}>确认执行</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
