import React, { useState, useMemo } from 'react';
import { getApi, CommandRegistry, CommandDef, CommandPayload, CommandRecord, AccountData } from '../../services/api';
import ResultRenderer from '../Results/ResultRenderer';
import LiveCollectionRenderer from '../Results/LiveCollectionRenderer';
import { ProgressOfferCardItem } from '../Results/ProgressOfferCard';
import type { DeepCollectDataPatch, DeepCollectTask } from '../Results/deepCollect/types';
import type { OzonListingTask } from '../Results/ozonListing/types';
import GlassSelect from '../Controls/GlassSelect';
import '../../components/Results/results.css';

interface Props {
  registry: CommandRegistry;
  activeProfile: string;
  accounts: AccountData;
  onHistoryRefresh: () => void;
  onDeepTasksChange?: (tasks: DeepCollectTask[]) => void;
  onOzonTasksChange?: (tasks: OzonListingTask[]) => void;
}

interface CommandUiSnapshot {
  args: Record<string, string>;
  options: Record<string, unknown>;
  lastRecord: CommandRecord | null;
  fieldErrors: Record<string, string>;
  alert: { text: string; kind: string } | null;
  placeholderCount: number;
  showAdvanced: boolean;
  pastedImageFile: File | null;
  pastedImagePreviewUrl: string | null;
  pastedImageName: string | null;
  pastedImageSize: number | null;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function offerIdOf(raw: Record<string, unknown>): string {
  return String(raw.offerId || raw.offer_id || raw.id || '');
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(objectOf).filter(Boolean) as Array<Record<string, unknown>> : [];
}

function upsertByOfferId(
  list: Array<Record<string, unknown>>,
  item: Record<string, unknown>,
  fallbackOfferId: string,
): Array<Record<string, unknown>> {
  const itemOfferId = offerIdOf(item) || fallbackOfferId;
  const next = list.filter((entry) => offerIdOf(entry) !== itemOfferId);
  next.push({ ...item, offerId: itemOfferId });
  return next;
}

function removeByOfferId(
  list: Array<Record<string, unknown>>,
  offerId: string,
): Array<Record<string, unknown>> {
  return list.filter((entry) => offerIdOf(entry) !== offerId);
}

function applyDeepCollectDataPatchToRecord(
  record: CommandRecord | null,
  patch: DeepCollectDataPatch,
): CommandRecord | null {
  if (!record?.stdoutJson || !patch.offerId) return record;

  const base = objectOf(record.stdoutJson);
  if (!base) return record;
  if (!Array.isArray(base.offers)) return record;

  const offers = asObjectArray(base.offers);
  const existingDeeppro = objectOf(base.deeppro) || {};
  const currentDeepOffers = asObjectArray(existingDeeppro.offers);
  const currentFailures = asObjectArray(existingDeeppro.failures);

  let nextDeepOffers = currentDeepOffers;
  let nextFailures = currentFailures;

  if (patch.deep) {
    nextDeepOffers = upsertByOfferId(currentDeepOffers, {
      ...patch.deep,
      offerId: patch.offerId,
    }, patch.offerId);
    nextFailures = removeByOfferId(currentFailures, patch.offerId);
  }

  if (patch.failure) {
    nextFailures = upsertByOfferId(currentFailures, {
      ...patch.failure,
      offerId: patch.offerId,
    }, patch.offerId);
    nextDeepOffers = removeByOfferId(currentDeepOffers, patch.offerId);
  }

  const nextOffers = offers.map((offer) => {
    if (offerIdOf(offer) !== patch.offerId) return offer;

    if (patch.deep) {
      const images = Array.isArray(patch.deep.images) ? patch.deep.images as string[] : [];
      return {
        ...offer,
        title: patch.deep.title || offer.title,
        image: patch.deep.mainImage || images[0] || offer.image,
        priceRange: patch.deep.priceRange || offer.priceRange,
        priceText: patch.deep.priceText || offer.priceText,
        deepCollected: true,
        deepCollectStatus: 'success',
        deepOffer: patch.deep,
        deepCollectMeta: patch.deep._deepCollectMeta,
      };
    }

    if (patch.failure) {
      return {
        ...offer,
        deepCollected: false,
        deepCollectStatus: 'failed',
        deepCollectFailure: patch.failure,
      };
    }

    return offer;
  });

  return {
    ...record,
    stdoutJson: {
      ...base,
      offers: nextOffers,
      deeppro: {
        ...existingDeeppro,
        enabled: true,
        mode: existingDeeppro.mode || 'manual-per-card',
        success: nextDeepOffers.length,
        failed: nextFailures.length,
        offers: nextDeepOffers,
        failures: nextFailures,
      },
    },
  };
}

export default function CommandPanel({ registry, activeProfile, accounts, onHistoryRefresh, onDeepTasksChange, onOzonTasksChange }: Props) {
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

  // Clipboard image paste state (image-search only)
  const [pastedImageFile, setPastedImageFile] = useState<File | null>(null);
  const [pastedImagePreviewUrl, setPastedImagePreviewUrl] = useState<string | null>(null);
  const [pastedImageName, setPastedImageName] = useState<string | null>(null);
  const [pastedImageSize, setPastedImageSize] = useState<number | null>(null);

  const [commandSnapshots, setCommandSnapshots] = useState<Record<string, CommandUiSnapshot>>({});

  const clearPastedImage = () => {
    if (pastedImagePreviewUrl) URL.revokeObjectURL(pastedImagePreviewUrl);
    setPastedImageFile(null);
    setPastedImagePreviewUrl(null);
    setPastedImageName(null);
    setPastedImageSize(null);
  };

  const handlePasteImage = (event: React.ClipboardEvent) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith('image/'));

    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;

    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'];
    if (!allowed.includes(file.type)) {
      setAlert({ text: '不支持的图片格式，请粘贴 PNG / JPEG / WebP / BMP 图片。', kind: 'warn' });
      return;
    }

    const maxBytes = 20 * 1024 * 1024;
    if (file.size > maxBytes) {
      setAlert({ text: `图片过大 (${(file.size / 1024 / 1024).toFixed(1)}MB > 20MB)。`, kind: 'warn' });
      return;
    }

    event.preventDefault();

    if (pastedImagePreviewUrl) URL.revokeObjectURL(pastedImagePreviewUrl);

    const previewUrl = URL.createObjectURL(file);
    setPastedImageFile(file);
    setPastedImagePreviewUrl(previewUrl);
    setPastedImageName(file.name || `clipboard-${Date.now()}.${file.type.split('/')[1] || 'png'}`);
    setPastedImageSize(file.size);
    if (fieldErrors.imagePath) {
      const e = { ...fieldErrors };
      delete e.imagePath;
      setFieldErrors(e);
    }
  };

  const api = getApi();
  const command = registry.commands[activeCmdId];
  const groupCommands = Object.values(registry.commands).filter((c) => c.group === 'sourcing' && c.id !== 'similar');
  const activeAccount = accounts.accounts.find((a) => a.profile === activeProfile);
  const alias = activeAccount?.alias || activeProfile;
  const hasEmbeddedRunButton = command?.positional.some((f) => f.name === 'keyword') ?? false;
  const isImageSearchCommand = activeCmdId === 'imageSearch';

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

  const defaultOptionsForCommand = (cmd?: CommandDef): Record<string, unknown> => {
    const defs: Record<string, unknown> = {};
    if (!cmd) return defs;
    for (const o of cmd.options) {
      if (o.type === 'boolean' && o.default) defs[o.name] = true;
      else if (o.default !== undefined && o.default !== '') defs[o.name] = o.default;
    }
    return defs;
  };

  const currentSnapshot = (): CommandUiSnapshot => ({
    args,
    options,
    lastRecord,
    fieldErrors,
    alert,
    placeholderCount,
    showAdvanced,
    pastedImageFile,
    pastedImagePreviewUrl,
    pastedImageName,
    pastedImageSize,
  });

  const handleDeepCollectDataPatch = (
    patch: DeepCollectDataPatch,
    targetCommandId = activeCmdId,
    targetRunId?: string,
  ) => {
    setLastRecord((prev) => {
      if (!prev) return prev;
      const isTargetRecord = targetRunId
        ? prev.runId === targetRunId
        : prev.commandId === targetCommandId;

      return isTargetRecord ? applyDeepCollectDataPatchToRecord(prev, patch) : prev;
    });

    setCommandSnapshots((snapshots) => {
      const existing = snapshots[targetCommandId];
      if (!existing?.lastRecord) return snapshots;
      if (targetRunId && existing.lastRecord.runId !== targetRunId) return snapshots;

      const nextLastRecord = applyDeepCollectDataPatchToRecord(existing.lastRecord, patch);
      if (nextLastRecord === existing.lastRecord) return snapshots;

      return {
        ...snapshots,
        [targetCommandId]: {
          ...existing,
          lastRecord: nextLastRecord,
        },
      };
    });
  };

  const selectCommand = (id: string) => {
    if (id === activeCmdId) return;

    const targetSnapshot = commandSnapshots[id];
    const targetCommand = registry.commands[id];

    // Save current tab state before switching
    setCommandSnapshots((prev) => ({
      ...prev,
      [activeCmdId]: currentSnapshot(),
    }));

    setActiveCmdId(id);
    setRunning(false);

    if (targetSnapshot) {
      setArgs(targetSnapshot.args);
      setOptions(targetSnapshot.options);
      setLastRecord(targetSnapshot.lastRecord);
      setFieldErrors(targetSnapshot.fieldErrors);
      setAlert(targetSnapshot.alert);
      setPlaceholderCount(targetSnapshot.placeholderCount);
      setShowAdvanced(targetSnapshot.showAdvanced);
      setPastedImageFile(targetSnapshot.pastedImageFile);
      setPastedImagePreviewUrl(targetSnapshot.pastedImagePreviewUrl);
      setPastedImageName(targetSnapshot.pastedImageName);
      setPastedImageSize(targetSnapshot.pastedImageSize);
      return;
    }

    setArgs({});
    setOptions(defaultOptionsForCommand(targetCommand));
    setLastRecord(null);
    setAlert(null);
    setFieldErrors({});
    setPlaceholderCount(0);
    setShowAdvanced(false);
    setPastedImageFile(null);
    setPastedImagePreviewUrl(null);
    setPastedImageName(null);
    setPastedImageSize(null);
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

      // clipboard mode: pasted image satisfies the imagePath requirement
      if (isImageSearchCommand && f.name === 'imagePath' && pastedImageFile) {
        continue;
      }

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

  // Two-stage desktop DEEPPRO: search first, then delegate deep collect to unified queue
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
      setAlert({
        text: '基础搜索失败，已保留上一批结果：' + (e as Error).message,
        kind: 'error',
      });
      setRunning(false);
      setLiveMode(false);
      setPlaceholderCount(0);
      setLiveCards([]);
      return;
    }

    const data = searchRecord.stdoutJson as Record<string, unknown> | undefined;
    const baseOffers = (data?.offers as Array<Record<string, unknown>>) || [];
    const keyword = String(data?.keyword ?? '');

    // Guard: don't overwrite results when search returns nothing
    if (baseOffers.length === 0) {
      setAlert({
        text: '基础搜索未返回商品，未启动深度采集，已保留上一批结果',
        kind: 'warn',
      });
      setLiveMode(false);
      setRunning(false);
      setPlaceholderCount(0);
      setLiveCards([]);
      return;
    }

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

    // Build base synthetic record — deep collect delegated to ResultRenderer / unified queue
    const synthetic: CommandRecord = {
      runId: 'desktop-deeppro-base-' + Date.now(),
      commandId: 'search',
      resultType: 'products',
      status: 'success',
      argv: [],
      stdoutJson: {
        keyword,
        offers: baseOffers,
        deeppro: {
          enabled: true,
          mode: 'queued-in-renderer',
          total: baseOffers.length,
          success: 0,
          failed: 0,
          offerIds: baseCards.filter((c) => c.offerId).map((c) => c.offerId),
          offers: [],
          failures: [],
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
    setAlert({ text: `基础搜索完成，共 ${baseOffers.length} 个商品，已加入深度采集队列`, kind: 'info' });
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

    // Build payload locally so clipboard tmpPath is guaranteed to be included.
    // React setArgs is async — calling collectPayload() after setArgs() may still
    // read the old args object and miss the temp file path.
    let payload = collectPayload(confirmed);

    // Clipboard mode: upload pasted image to temp file before running CLI
    if (isImageSearchCommand && pastedImageFile) {
      try {
        setAlert({ text: '正在上传图片...', kind: 'info' });
        const buf = await pastedImageFile.arrayBuffer();
        const base64 = btoa(
          Array.from(new Uint8Array(buf))
            .map((b) => String.fromCharCode(b))
            .join(''),
        );
        const { path: tmpPath } = await api.files.writeTempImage(base64, pastedImageFile.type);

        payload = {
          ...payload,
          args: {
            ...payload.args,
            imagePath: tmpPath,
          },
        };

        // Sync state for UI preview / subsequent runs
        setArgs((prev) => ({ ...prev, imagePath: tmpPath }));
      } catch (e) {
        setAlert({ text: '图片上传失败: ' + (e as Error).message, kind: 'error' });
        return;
      }
    }

    setPlaceholderCount(placeholderCountForCommand());
    setRunning(true);
    setAlert({ text: '命令执行中...', kind: 'info' });
    try {
      const record = await api.commands.run(payload);
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

  const visibleRecord =
    lastRecord && lastRecord.commandId === activeCmdId
      ? lastRecord
      : null;

  const resultCount = useMemo(() => {
    if (!visibleRecord) return '等待执行';
    const d = visibleRecord.stdoutJson as Record<string, unknown> | undefined;
    if (d?.offers && Array.isArray(d.offers)) return `${d.offers.length} 个商品`;
    if (d?.items && Array.isArray(d.items)) return `${d.items.length} 条结果`;
    return '已执行';
  }, [visibleRecord]);

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
                    ) : isImageSearchCommand ? (
                      /* Image-search: supports clipboard paste + URL input */
                      <>
                        <div
                          className={`image-search-paste-zone ${hasErr ? 'field-error' : ''}`}
                          tabIndex={0}
                          onPaste={handlePasteImage}
                        >
                          {pastedImagePreviewUrl ? (
                            <div className="clipboard-preview">
                              <img src={pastedImagePreviewUrl} alt="已粘贴图片" className="clipboard-preview-img" />
                              <div className="clipboard-preview-info">
                                <span className="clipboard-preview-name">{pastedImageName || 'clipboard.png'}</span>
                                <span className="clipboard-preview-size">
                                  {pastedImageSize != null
                                    ? pastedImageSize >= 1024 * 1024
                                      ? `${(pastedImageSize / 1024 / 1024).toFixed(1)}MB`
                                      : `${Math.round(pastedImageSize / 1024)}KB`
                                    : ''}
                                </span>
                                <button type="button" className="clipboard-preview-clear" onClick={(e) => { e.stopPropagation(); clearPastedImage(); }}>
                                  清除图片
                                </button>
                              </div>
                            </div>
                          ) : (
                            <input
                              className={`glass-input ${hasErr ? 'field-error' : ''}`}
                              type="text"
                              value={args[f.name] || ''}
                              placeholder="输入图片 URL，或点击此处后 Ctrl+V 粘贴图片"
                              onChange={(e) => { setArgs({ ...args, [f.name]: e.target.value }); clearFieldError(f.name); }}
                            />
                          )}
                        </div>
                        {hasErr && <p className="field-error-text">{fieldErrors[f.name]}</p>}
                        <p className="image-search-paste-hint">
                          💡 支持直接粘贴图片：复制任意商品图后在此区域 Ctrl+V
                        </p>
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
                  className={`glass-toggle-chip ${options.captchaRetryHeaded ? 'active' : ''}`}
                  disabled={!options.deeppro}
                  title={options.deeppro ? '第一次无头采集遇到验证码/风控时，第二次自动打开浏览器供人工处理' : '请先勾选"采集商品详情"'}
                  onClick={() => setOptions({ ...options, captchaRetryHeaded: !options.captchaRetryHeaded })}
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
              captchaRetryHeaded={!!options.captchaRetryHeaded}
              onDeepTasksChange={onDeepTasksChange}
              onOzonTasksChange={onOzonTasksChange}
              onDeepCollectDataPatch={(patch) => handleDeepCollectDataPatch(patch, activeCmdId)}
            />
          </>
        ) : visibleRecord ? (
          <>
            <p className="result-count">{resultCount}</p>
            <ResultRenderer
              record={visibleRecord}
              resultType={command.resultType}
              placeholderCards={placeholderCount}
              running={false}
              activeProfile={activeProfile}
              manualDeepCollectHeaded={!!options.headed}
              captchaRetryHeaded={!!options.captchaRetryHeaded}
              autoDeepCollectOnMount={Boolean(visibleRecord && visibleRecord.runId?.startsWith('desktop-deeppro-base-'))}
              onDeepTasksChange={onDeepTasksChange}
              onOzonTasksChange={onOzonTasksChange}
              onDeepCollectDataPatch={(patch) => handleDeepCollectDataPatch(patch, visibleRecord.commandId, visibleRecord.runId)}
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
