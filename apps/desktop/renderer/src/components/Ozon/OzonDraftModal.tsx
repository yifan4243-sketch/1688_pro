import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getApi, OzonDraft, OzonSettingsPublic } from '../../services/api';
import { ProgressOfferCardItem } from '../Results/ProgressOfferCard';
import { progressCardToOzonRows } from '../../services/ozon-source-adapter';
import './ozon.css';

interface Props {
  item: ProgressOfferCardItem;
  onClose: () => void;
}

export default function OzonDraftModal({ item, onClose }: Props) {
  const api = getApi();
  const rows = useMemo(() => progressCardToOzonRows(item), [item]);
  const [settings, setSettings] = useState<OzonSettingsPublic | null>(null);
  const [draft, setDraft] = useState<OzonDraft | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState<{ kind: string; text: string } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    api.ozon.getSettings()
      .then((data) => {
        setSettings(data);
      })
      .catch((error) => setMessage({ kind: 'error', text: error.message || String(error) }));
  }, []);

  const sourceMissing = Array.from(new Set(rows.flatMap((row) => row.missing_fields as string[] || [])));
  const canGenerate = Boolean(settings?.ai.apiKeySet);

  const generate = async () => {
    setBusy('generate');
    setMessage(null);
    try {
      if (!settings?.ai.apiKeySet) {
        setMessage({ kind: 'warn', text: '请先在右上角「AI 设置」中保存 DeepSeek API Key。' });
        return;
      }
      const result = await api.ozon.generateDraft(rows);
      setDraft(result);
      setMessage({ kind: result.missing.length ? 'warn' : 'success', text: result.missing.length ? `草稿已生成，但缺少：${result.missing.join('、')}` : 'Ozon 草稿已生成。' });
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setBusy('');
    }
  };

  const firstItem = draft?.items?.[0] || null;
  const generated = draft?.generated || {};

  return createPortal(
    <div className="ozon-backdrop" onClick={onClose}>
      <section className="ozon-modal" onClick={(event) => event.stopPropagation()}>
        <header className="ozon-modal-head">
          <div>
            <span>1688 → Ozon</span>
            <h3>Ozon 上架草稿</h3>
          </div>
          <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
        </header>

        {message && <div className={`ozon-message ${message.kind}`}>{message.text}</div>}

        <div className="ozon-layout">
          <aside className="ozon-source-card">
            {item.image && !imageFailed ? (
              <img src={item.image} alt="" onError={() => setImageFailed(true)} />
            ) : (
              <div className="ozon-image-placeholder">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="rgba(15,23,42,0.24)" strokeWidth="1.4">
                  <rect x="3" y="3" width="18" height="18" rx="3"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </svg>
                <span>图片暂不可预览</span>
              </div>
            )}
            <h4>{item.title || '未识别商品'}</h4>
            <p>{item.price || '暂无价格'} · {rows.length} 个 SKU 行</p>
            <div className="ozon-chip-row">
              <span>{item.offerId || '无 Offer ID'}</span>
              <span>{item.status === 'deep-success' ? '深采完成' : '基础数据'}</span>
            </div>
            {sourceMissing.length > 0 && (
              <div className="ozon-warning">
                1688 数据缺字段：{sourceMissing.slice(0, 6).join('、')}
              </div>
            )}
          </aside>

          <div className="ozon-main">
            <section className="ozon-panel compact-status-panel">
              <div className="ozon-panel-title">
                <h4>全局连接状态</h4>
                <span className="ozon-settings-hint">密钥和店铺绑定请在右上角配置，一次保存后长期复用。</span>
              </div>
              <div className="ozon-status-strip">
                <span className={settings?.ai.apiKeySet ? 'ready' : 'missing'}>
                  AI：{settings?.ai.apiKeySet ? `已配置 ${settings.ai.model}` : '未配置'}
                </span>
                <span className={settings?.ozon.apiKeySet && settings.ozon.clientId ? 'ready' : 'missing'}>
                  Ozon：{settings?.ozon.apiKeySet && settings.ozon.clientId ? `已绑定 ${settings.ozon.shopName || settings.ozon.clientId}` : '未绑定'}
                </span>
                <span className={settings?.ozon.currencyCode ? 'ready' : 'missing'}>
                  货币：{settings?.ozon.currencyCode || '未设置'}{settings?.ozon.isDefaultShop ? ' / 默认店铺' : ''}
                </span>
              </div>
            </section>

            <section className="ozon-panel">
              <div className="ozon-panel-title">
                <h4>AI 草稿</h4>
                <button className="glass-btn-primary" disabled={!canGenerate || busy === 'generate'} onClick={generate}>
                  {busy === 'generate' ? 'AI 生成中...' : '生成 Ozon 草稿'}
                </button>
              </div>
              {!draft ? (
                <p className="ozon-empty">保存 DeepSeek 配置后生成俄语标题、描述、关键词和 Ozon payload。</p>
              ) : (
                <div className="ozon-draft-preview">
                  <h3>{String(generated.title_ru || firstItem?.name || '')}</h3>
                  <p className="ozon-category">{String((generated.matched_category as Record<string, unknown> | undefined)?.path || firstItem?._category_path || '未匹配类目')}</p>
                  <p>{String(generated.description_ru || '').slice(0, 260)}{String(generated.description_ru || '').length > 260 ? '...' : ''}</p>
                  <div className="ozon-chip-row">
                    {(generated.tags as string[] | undefined || []).slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  {draft.missing.length > 0 && <div className="ozon-warning">提交前需补齐：{draft.missing.join('、')}</div>}
                </div>
              )}
            </section>

            <section className="ozon-panel">
              <div className="ozon-panel-title">
                <h4>提交预览</h4>
                <span className="ozon-settings-hint">Phase 1 仅生成草稿，不提交到 Ozon。</span>
              </div>
              <pre className="ozon-json">{draft ? JSON.stringify(draft.items, null, 2) : '等待生成草稿...'}</pre>
            </section>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
