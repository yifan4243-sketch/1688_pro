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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
    setFieldErrors({});
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

  const validateBeforeRun = (): boolean => {
    if (!command) return false;
    const errors: Record<string, string> = {};
    for (const f of command.positional) {
      if (!f.required) continue;
      const val = (args[f.name] || '').trim();
      if (!val) {
        // Human-friendly messages
        const labels: Record<string, string> = {
          keyword: '请输入搜索词',
          offerIds: '请输入商品 Offer ID',
          offerId: '请输入商品 Offer ID',
          requestId: '请输入 Debug Request ID',
          target: '请输入 Offer ID / memberId 等',
          orderId: '请输入订单 ID',
          cartIds: '请输入购物车 Cart ID',
          message: '请输入内容',
          keywords: '请输入关键词',
          imagePath: '请输入图片地址',
        };
        errors[f.name] = labels[f.name] || `请输入${f.label}`;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const isFieldError = (name: string) => !!fieldErrors[name];

  const clearFieldError = (name: string) => {
    if (fieldErrors[name]) {
      const next = { ...fieldErrors };
      delete next[name];
      setFieldErrors(next);
    }
  };

  const runCommand = async (confirmed = false) => {
    if (!validateBeforeRun()) return;
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

  const fillKeyword = (kw: string) => {
    setArgs({ ...args, keyword: kw });
    if (fieldErrors.keyword) { const e = { ...fieldErrors }; delete e.keyword; setFieldErrors(e); }
  };

  return (
    <div className="command-workspace">
      {/* ── Header panel: title + tabs + task picker ── */}
      <section className="command-header-panel">
        <div className="section-head">
          <h3>命令面板</h3>
          <span>{chineseHint}</span>
        </div>

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

        <div className="command-picker">
          <span className="command-picker-label">任务类型</span>
          <div className="command-segmented-picker">
            {groupCommands.map((cmd) => (
              <button
                key={cmd.id}
                type="button"
                className={`command-segment ${cmd.id === activeCmdId ? 'active' : ''}`}
                onClick={() => selectCommand(cmd.id)}
                title={cmd.id}
              >
                {cmd.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Form — compact control panel */}
      {command && (
        <form className="command-control-panel" onSubmit={(e) => { e.preventDefault(); runCommand(); }}>
          {/* Row 1: search/command bar with embedded execute button */}
          {command.positional.length > 0 && (
            <div className="search-command-wrapper">
              {command.positional.map((f) => {
                const hasErr = isFieldError(f.name);
                const isKeyword = f.name === 'keyword';
                return (
                  <div key={f.name} className="search-command-field">
                    <label className="form-label">{f.label}{f.required && <span className="required">*</span>}</label>
                    {isKeyword ? (
                      /* Keyword: pill search bar with embedded button */
                      <div className={`search-command-box ${hasErr ? 'has-error' : ''}`}>
                        <input
                          className="search-command-input"
                          value={args[f.name] || ''}
                          placeholder={hasErr ? '请输入搜索词' : '请输入搜索词，例如：上衣'}
                          onChange={(e) => { setArgs({ ...args, [f.name]: e.target.value }); clearFieldError(f.name); }}
                        />
                        <button type="button" className="search-command-button" disabled={running}
                          onClick={() => runCommand()}>
                          {running ? '执行中...' : '执行命令'}
                        </button>
                      </div>
                    ) : f.multiline || f.array ? (
                      <>
                        <textarea
                          className={`glass-textarea ${hasErr ? 'field-error' : ''}`}
                          rows={f.array ? 4 : 5}
                          value={args[f.name] || ''}
                          onChange={(e) => { setArgs({ ...args, [f.name]: e.target.value }); clearFieldError(f.name); }}
                        />
                        {hasErr && <p className="field-error-text">{fieldErrors[f.name]}</p>}
                      </>
                    ) : (
                      <>
                        <input
                          className={`glass-input ${hasErr ? 'field-error' : ''}`}
                          type="text"
                          value={args[f.name] || ''}
                          placeholder={hasErr ? fieldErrors[f.name] : undefined}
                          onChange={(e) => { setArgs({ ...args, [f.name]: e.target.value }); clearFieldError(f.name); }}
                        />
                        {hasErr && <p className="field-error-text">{fieldErrors[f.name]}</p>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Short fields — compact grid */}
          {command.options.filter((o) => o.type !== 'boolean' && !o.name.startsWith('deepproDelay')).length > 0 && (
            <div className="compact-grid">
              {command.options.filter((o) => o.type !== 'boolean' && !o.name.startsWith('deepproDelay')).map((o) => {
                if (o.type === 'select') {
                  return (
                    <div key={o.name} className="form-field compact">
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
                  <div key={o.name} className="form-field compact">
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
          )}

          {/* Toggle chips for boolean options */}
          {command.options.filter((o) => o.type === 'boolean').length > 0 && (
            <div className="glass-toggle-row">
              {command.options.filter((o) => o.type === 'boolean').map((o) => (
                <button key={o.name} type="button"
                  className={`glass-toggle-chip ${options[o.name] ? 'active' : ''}`}
                  onClick={() => setOptions({ ...options, [o.name]: !options[o.name] })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}

          {/* Advanced: deeppro delay fields, collapsed unless deeppro is on */}
          {command.options.filter((o) => o.name.startsWith('deepproDelay')).length > 0 && (
            <details className="advanced-section" open={!!options.deeppro}>
              <summary className="advanced-toggle">高级采集参数</summary>
              <div className="compact-grid" style={{ marginTop: 10 }}>
                {command.options.filter((o) => o.name.startsWith('deepproDelay')).map((o) => (
                  <div key={o.name} className="form-field compact">
                    <label className="form-label">{o.label}</label>
                    <input className="glass-input" type="number"
                      value={String(options[o.name] ?? o.default ?? '')}
                      onChange={(e) => setOptions({ ...options, [o.name]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Row: execute + advanced info — only if no positional fields (no keyword row) */}
          {command.positional.length === 0 && (
            <div className="run-bar">
              <button className="glass-btn-primary" disabled={running} onClick={() => runCommand()}>
                {running ? '执行中...' : '执行命令'}
              </button>
              <button type="button" className="glass-btn-ghost" onClick={() => setShowAdvanced(!showAdvanced)}>
                {showAdvanced ? '隐藏 CLI 预览' : '高级信息'}
              </button>
            </div>
          )}
        </form>
      )}

      {showAdvanced && (
        <div className="command-preview">
          <span>CLI 预览</span>
          <code>{previewArgv}</code>
        </div>
      )}

      {alert && (
        <div className={`alert ${alert.kind}`}>{alert.text}</div>
      )}

      {/* ── Result workspace — always present ── */}
      <section className="result-workspace">
        {running ? (
          <div className="running-state">
            <div className="running-header">正在采集 1688 商品数据...</div>
            <div className="running-chips">
              <span className="running-chip">连接账号档案 {alias}</span>
              <span className="running-chip">等待 1688 返回结果</span>
              <span className="running-chip">解析商品信息</span>
            </div>
          </div>
        ) : lastRecord ? (
          <>
            <p className="result-count">{resultCount}</p>
            <ResultRenderer record={lastRecord} resultType={command.resultType} />
          </>
        ) : (
          <div className="empty-result-state">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(15,23,42,0.20)" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
            </div>
            <h4>开始一次 1688 采集</h4>
            <p className="empty-desc">
              输入搜索词后，系统会采集商品标题、价格、供应商、地区、<br/>
              成交数据、SKU / 库存 / 属性、商品图片。
            </p>
            <p className="empty-hint">建议先测试：</p>
            <div className="empty-actions">
              <button className="glass-btn-secondary" onClick={() => fillKeyword('上衣')}>上衣</button>
              <button className="glass-btn-secondary" onClick={() => fillKeyword('帽子')}>帽子</button>
              <button className="glass-btn-secondary" onClick={() => fillKeyword('手机壳')}>手机壳</button>
            </div>
          </div>
        )}
      </section>

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
    </div>
  );
}
