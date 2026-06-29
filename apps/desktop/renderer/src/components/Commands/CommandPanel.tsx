import React, { useState, useMemo } from 'react';
import { getApi, CommandRegistry, CommandDef, CommandPayload, CommandRecord, AccountData } from '../../services/api';
import ResultRenderer from '../Results/ResultRenderer';
import LiveCollectionRenderer from '../Results/LiveCollectionRenderer';
import { ProgressOfferCardItem } from '../Results/ProgressOfferCard';
import GlassSelect from '../Controls/GlassSelect';
import '../../components/Results/results.css';

interface Props {
  registry: CommandRegistry;
  activeProfile: string;
  accounts: AccountData;
  onHistoryRefresh: () => void;
  onDeepTasksChange?: (tasks: Array<{ key: string; offerId?: string; title?: string; image?: string; status: 'queued' | 'collecting' | 'success' | 'failed'; message?: string; createdAt: string; finishedAt?: string }>) => void;
}

export default function CommandPanel({ registry, activeProfile, accounts, onHistoryRefresh, onDeepTasksChange }: Props) {
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
  const [placeholderCount, setPlaceholderCount] = useState(0);

  // Live two-stage DEEPPRO state
  const [liveCards, setLiveCards] = useState<ProgressOfferCardItem[]>([]);
  const [liveMode, setLiveMode] = useState(false);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);

  const api = getApi();
  const command = registry.commands[activeCmdId];
  const groupCommands = Object.values(registry.commands).filter((c) => c.group === 'sourcing' && c.id !== 'similar');
  const activeAccount = accounts.accounts.find((a) => a.profile === activeProfile);
  const alias = activeAccount?.alias || activeProfile;
  const hasEmbeddedRunButton = command?.positional.some((f) => f.name === 'keyword') ?? false;

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
    if (id === activeCmdId) return;

    setActiveCmdId(id);
    setArgs({});
    setOptions({});
    setLastRecord(null);
    setAlert(null);
    setFieldErrors({});
    setPlaceholderCount(0);
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

  // Two-stage desktop DEEPPRO: search first, then offer --pro per offerId
  const runDesktopDeepPro = async () => {
    const max = Number(options.max || 20);
    if (!max || max < 1) return;
    setPlaceholderCount(max);
    setLiveMode(true);
    setLiveCards(Array.from({ length: max }, (_, i) => ({ slotIndex: i, status: 'waiting' as const })));
    setRunning(true);
    setAlert({ text: '正在搜索基础商品...', kind: 'info' });

    // Stage 1: basic search without deeppro
    const basicSearchPayload = collectPayload(false);
    basicSearchPayload.options = { ...basicSearchPayload.options, deeppro: false };

    let searchRecord: CommandRecord;
    try {
      searchRecord = await api.commands.run(basicSearchPayload);
    } catch (e) {
      setAlert({ text: '基础搜索失败: ' + (e as Error).message, kind: 'error' });
      setRunning(false);
      setLiveMode(false);
      return;
    }

    const data = searchRecord.stdoutJson as Record<string, unknown> | undefined;
    const baseOffers = (data?.offers as Array<Record<string, unknown>>) || [];
    const keyword = String(data?.keyword ?? '');

    // Write base offers to product history immediately
    try {
      await api.productHistory.add(baseOffers, { sourceCommand: 'search', profile: activeProfile });
    } catch { /* best-effort */ }

    // Build base cards immediately
    const baseCards: ProgressOfferCardItem[] = [];
    for (let i = 0; i < max; i++) {
      const offer = baseOffers[i];
      if (offer && offer.offerId && offer.title) {
        const p = offer.price as Record<string, unknown> | undefined;
        baseCards.push({
          slotIndex: i,
          offerId: String(offer.offerId),
          title: String(offer.title),
          price: p?.text ? String(p.text) : p?.min != null ? `¥${p.min}` + (p.max != null && p.max !== p.min ? `-${p.max}` : '') : '',
          image: String(offer.image || ''),
          status: 'basic-ready',
          pendingDeep: true,
          raw: offer,
        });
      } else {
        baseCards.push({ slotIndex: i, status: 'waiting' as const });
      }
    }
    setLiveCards(baseCards);
    setAlert({ text: `基础搜索完成，共 ${baseOffers.length} 个商品，开始深度采集...`, kind: 'info' });

    const deepOffers: Record<string, unknown>[] = [];
    const failures: Record<string, unknown>[] = [];

    // Stage 2: offer --pro for each base card
    for (let i = 0; i < baseCards.length; i++) {
      const card = baseCards[i]!;
      if (!card.offerId) continue;

      // Mark as collecting
      baseCards[i] = { ...card, status: 'deep-collecting' };
      setLiveCards([...baseCards]);

      const delayMs = (Math.random() * (Number(options.deepproDelayMax || 3) - Number(options.deepproDelayMin || 1)) + Number(options.deepproDelayMin || 1)) * 1000;
      if (i > 0) await new Promise((r) => setTimeout(r, delayMs));

      try {
        const offerPayload: CommandPayload = {
          commandId: 'offer',
          args: { offerIds: card.offerId },
          options: { pro: true, headed: !!options.headed },
          profile: activeProfile,
        };
        const offerRecord = await api.commands.run(offerPayload);
        const deep = offerRecord.stdoutJson as Record<string, unknown> | undefined;

        if (deep && deep.title && deep.title !== 'Captcha Interception' && !/captcha|验证码|滑块|风控/i.test(String(deep.title))) {
          baseCards[i] = {
            ...card,
            title: String(deep.title || card.title),
            price: String(deep.priceRange || card.price),
            image: String(deep.mainImage || (deep.images as string[])?.[0] || card.image),
            status: 'deep-success' as const,
            raw: deep,
          };
          deepOffers.push(deep);
        } else {
          const reason = !deep ? '返回结果为空' : deep.title === 'Captcha Interception' ? '页面被验证码拦截' : '深度采集结果不完整';
          baseCards[i] = { ...card, status: 'deep-failed' as const, message: reason, code: 'INVALID_DEEP_OFFER' };
          failures.push({ offerId: card.offerId, code: 'INVALID_DEEP_OFFER', message: reason, attempts: 1 });
        }
      } catch (e) {
        const err = e as Error & { code?: string };
        baseCards[i] = { ...card, status: 'deep-failed' as const, message: err.message || '采集失败', code: err.code || 'UNKNOWN_ERROR' };
        failures.push({ offerId: card.offerId, code: err.code || 'UNKNOWN_ERROR', message: err.message || '采集失败', attempts: 1 });
      }
      setLiveCards([...baseCards]);
    }

    // Build synthetic record for history/JSON mode
    const synthetic: CommandRecord = {
      runId: 'desktop-deeppro-' + Date.now(),
      commandId: 'search',
      resultType: 'products',
      status: 'success',
      argv: [],
      stdoutJson: {
        keyword,
        offers: baseOffers,
        deeppro: {
          enabled: true,
          total: max,
          success: deepOffers.length,
          failed: failures.length,
          offerIds: baseCards.filter((c) => c.offerId).map((c) => c.offerId),
          offers: deepOffers,
          failures,
        },
      },
      stderrText: liveLogs.join('\n'),
      error: null,
      startedAt: new Date().toISOString(),
    };
    setLastRecord(synthetic);
    setLiveMode(false);
    setRunning(false);
    setPlaceholderCount(0);
    setAlert({ text: `DEEPPRO 完成：${deepOffers.length}/${max} 成功` + (failures.length > 0 ? `，${failures.length} 失败` : ''), kind: 'success' });
    onHistoryRefresh();
  };

  const runCommand = async (confirmed = false) => {
    if (!validateBeforeRun()) return;
    if (command.write && !confirmed) {
      setPendingPayload(collectPayload(false));
      setShowConfirm(true);
      return;
    }

    // Desktop DEEPPRO: two-stage orchestration
    if (activeCmdId === 'search' && options.deeppro === true) {
      await runDesktopDeepPro();
      return;
    }

    setPlaceholderCount(placeholderCountForCommand());
    setRunning(true);
    setAlert({ text: '命令执行中...', kind: 'info' });
    try {
      const record = await api.commands.run(collectPayload(confirmed));
      setLastRecord(record);
      // Write offers to product history
      if (activeCmdId === 'search' && record.stdoutJson) {
        const offers = (record.stdoutJson as Record<string, unknown>)?.offers as Array<Record<string, unknown>> | undefined;
        if (offers?.length) {
          api.productHistory.add(offers, { sourceCommand: 'search', profile: activeProfile }).catch(() => {});
        }
      }
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
      setPlaceholderCount(0);
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

  const isDeepProAdvancedOption = (name: string): boolean =>
    name === 'deepproDelayMin' ||
    name === 'deepproDelayMax' ||
    name === 'deepproSearchMode' ||
    name === 'deepproOutputDir';

  const placeholderCountForCommand = (): number => {
    if (!command || !['products', 'offers', 'research', 'comparison'].includes(command.resultType)) return 0;
    const countFromText = (value: string | undefined): number =>
      (value || '').split(/[\r\n,]+/).map((item) => item.trim()).filter(Boolean).length;
    if (activeCmdId === 'offer') return Math.max(1, countFromText(args.offerIds || args.offerId));
    if (activeCmdId === 'compare') return Math.max(1, countFromText(args.offerIds));
    if (activeCmdId === 'research') {
      const keywords = Math.max(1, countFromText(args.keywords));
      const maxPerQuery = Number(options.maxPerQuery || options.max || 20);
      return Math.min(24, Math.max(1, keywords * (maxPerQuery > 0 ? maxPerQuery : 20)));
    }
    const max = Number(options.max || 20);
    if (!Number.isFinite(max) || max <= 0) return 20;
    return Math.min(max, 600);
  };

  return (
    <div className="command-workspace">
      {/* ── Header panel: title + tabs + task picker ── */}
      <section className="command-header-panel">
        <div className="section-head">
          <h3>命令面板</h3>
          <span>{chineseHint}</span>
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
          {command.options.filter((o) => o.type !== 'boolean' && !isDeepProAdvancedOption(o.name)).length > 0 && (
            <div className="compact-grid">
              {command.options.filter((o) => o.type !== 'boolean' && !isDeepProAdvancedOption(o.name)).map((o) => {
                if (o.type === 'select') {
                  return (
                    <div key={o.name} className="form-field compact">
                      <label className="form-label">{o.label}</label>
                      <GlassSelect
                        className="glass-select"
                        value={String(options[o.name] ?? o.default ?? '')}
                        options={(o.values || []).map((v) => ({ value: v.value, label: v.label }))}
                        onChange={(value) => setOptions({ ...options, [o.name]: value })}
                      />
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

          {/* Option chips + command actions */}
          {(command.options.filter((o) => o.type === 'boolean').length > 0 || !hasEmbeddedRunButton || command.id === 'search') && (
            <div className="command-action-row">
              {!hasEmbeddedRunButton && (
                <div className="command-run-actions">
                  <button className="glass-btn-primary" disabled={running} onClick={() => runCommand()}>
                    {running ? '执行中...' : '执行命令'}
                  </button>
                  <button type="button" className="glass-btn-ghost" onClick={() => setShowAdvanced(!showAdvanced)}>
                    {showAdvanced ? '隐藏 CLI 预览' : '高级信息'}
                  </button>
                </div>
              )}
              {command.options.filter((o) => o.type === 'boolean').map((o) => (
                <button key={o.name} type="button"
                  className={`glass-toggle-chip ${options[o.name] ? 'active' : ''}`}
                  onClick={() => setOptions({ ...options, [o.name]: !options[o.name] })}
                >
                  {o.label}
                </button>
              ))}
              {command.id === 'search' && (
                <button
                  type="button"
                  className="glass-toggle-chip planned"
                  disabled
                  title="预留功能：遇到验证码时自动打开浏览器手动过验证"
                >
                  验证码自动开浏览器
                </button>
              )}
            </div>
          )}

          {/* Advanced: deeppro extended params, collapsed unless deeppro is on */}
          {command.id === 'search' && command.options.filter((o) => isDeepProAdvancedOption(o.name)).length > 0 && (
            <details className="advanced-section" open={!!options.deeppro}>
              <summary className="advanced-toggle">高级采集参数</summary>
              <p className="advanced-hint">敏感类目或出现 deeppro 全部失败时，尝试切换为 daemon 模式。</p>
              <div className="compact-grid" style={{ marginTop: 10 }}>
                {command.options.filter((o) => isDeepProAdvancedOption(o.name)).map((o) => {
                  if (o.type === 'select') {
                    return (
                      <div key={o.name} className="form-field compact">
                        <label className="form-label">{o.label}</label>
                        <GlassSelect
                          className="glass-select"
                          value={String(options[o.name] ?? o.default ?? '')}
                          options={(o.values || []).map((v) => ({ value: v.value, label: v.label }))}
                          onChange={(value) => setOptions({ ...options, [o.name]: value })}
                        />
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
            </details>
          )}

        </form>
      )}

      {showAdvanced && (
        <div className="command-preview">
          <span>CLI 预览</span>
          <code>{previewArgv}</code>
        </div>
      )}

      {alert && (alert.kind === 'error' || alert.kind === 'warn') && (
        <div className={`alert ${alert.kind}`}>{alert.text}</div>
      )}

      {/* ── Result workspace — always present ── */}
      <section className="result-workspace">
        {liveMode ? (
          <LiveCollectionRenderer
            cards={liveCards}
            running={running}
            keyword={String(args.keyword || '')}
          />
        ) : running && placeholderCount > 0 ? (
          <>
            <div className="running-mini-bar">命令执行中...</div>
            <ResultRenderer
              record={null}
              resultType={command.resultType}
              placeholderCards={placeholderCount}
              running={true}
              activeProfile={activeProfile}
              manualDeepCollectHeaded={!!options.headed}
              onDeepTasksChange={onDeepTasksChange}
            />
          </>
        ) : lastRecord ? (
          <>
            <p className="result-count">{resultCount}</p>
            <ResultRenderer
              record={lastRecord}
              resultType={command.resultType}
              placeholderCards={placeholderCount}
              running={false}
              activeProfile={activeProfile}
              manualDeepCollectHeaded={!!options.headed}
              onDeepTasksChange={onDeepTasksChange}
            />
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
        <div className="modal-backdrop confirm-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false); }}>
          <div className="modal confirm-modal">
            <div className="confirm-modal-header">
              <div className="confirm-icon">!</div>
              <div>
                <h3>确认执行写操作</h3>
                <p>{command.checkoutConfirm ? '确认下单会提交真实 1688 订单。请确认已查看 checkout prepare 预览。' : '该命令会修改账号状态、发送消息或变更购物车。请确认目标和参数。'}</p>
              </div>
            </div>
            <div className="confirm-command-preview">
              <span>即将执行的 CLI 命令</span>
              <code>{previewArgv}</code>
            </div>
            <div className="modal-actions confirm-actions">
              <button className="glass-btn-ghost" onClick={() => setShowConfirm(false)}>取消</button>
              <button className="glass-btn-primary" style={{background: 'linear-gradient(135deg, rgba(220,38,38,0.92), rgba(200,30,30,0.88))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28), 0 12px 28px rgba(220,38,38,0.22)'}} onClick={approveConfirm}>确认执行</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
