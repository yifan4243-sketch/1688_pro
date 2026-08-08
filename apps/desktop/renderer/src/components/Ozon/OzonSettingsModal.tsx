import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getApi, OzonSettingsPublic, OzonStoreStats } from '../../services/api';
import GlassSelect from '../Controls/GlassSelect';
import './ozon.css';

type Mode = 'ai' | 'store';

interface Props {
  mode: Mode;
  open: boolean;
  onClose: () => void;
}

export default function OzonSettingsModal({ mode, open, onClose }: Props) {
  const api = getApi();
  const [settings, setSettings] = useState<OzonSettingsPublic | null>(null);
  const [storeTab, setStoreTab] = useState<'add' | 'manage' | 'pricing'>('add');
  const [storeStats, setStoreStats] = useState<OzonStoreStats | null>(null);
  const [form, setForm] = useState({
    aiBaseUrl: 'https://api.deepseek.com',
    aiModel: 'deepseek-chat',
    aiApiKey: '',
    ozonClientId: '',
    ozonApiKey: '',
    shopName: '',
    currencyCode: 'CNY',
    isDefaultShop: false,
    note: '',
    warehouseId: '',
    otherFeePercent: '10',
    targetProfitPercent: '20',
    labelFeeCny: '2',
    shippingSpeed: 'economy',
    handoffMode: 'pickup',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: string; text: string } | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setStoreTab(mode === 'store' ? 'add' : 'add');
    setStoreStats(null);
    api.ozon.getSettings()
      .then((data) => {
        setSettings(data);
        setForm((prev) => ({
          ...prev,
          aiBaseUrl: data.ai.baseUrl || prev.aiBaseUrl,
          aiModel: data.ai.model || prev.aiModel,
          aiApiKey: '',
          ozonClientId: data.ozon.clientId || '',
          ozonApiKey: '',
          shopName: data.ozon.shopName || '',
          currencyCode: data.ozon.currencyCode || 'CNY',
          isDefaultShop: Boolean(data.ozon.isDefaultShop),
          note: data.ozon.note || '',
          warehouseId: data.ozon.defaultWarehouseId || '',
          otherFeePercent: String((data.pricing.otherFeeRate ?? 0.1) * 100),
          targetProfitPercent: String((data.pricing.targetProfitRate ?? 0.2) * 100),
          labelFeeCny: String(data.pricing.labelFeeCny ?? 2),
          shippingSpeed: data.pricing.shippingSpeed || 'economy',
          handoffMode: data.pricing.handoffMode || 'pickup',
        }));
      })
      .catch((error) => setMessage({ kind: 'error', text: error.message || String(error) }));
  }, [open]);

  if (!open) return null;

  const isAi = mode === 'ai';
  const title = isAi ? 'AI 设置' : storeTab === 'add' ? '添加店铺授权' : storeTab === 'manage' ? '店铺管理' : '自动定价设置';
  const subtitle = isAi
    ? '配置 DeepSeek 后，所有商品草稿都会复用这组 AI 参数。'
    : storeTab === 'add'
      ? '绑定一次 Ozon 店铺，之后提交上架会自动复用。'
      : storeTab === 'manage'
        ? '查看已绑定店铺和今日可上架额度。'
        : '设置草稿生成时自动使用的利润、杂费和 CEL 运输方式。';
  const noteLength = form.note.length;

  const refreshStoreStats = async () => {
    setStatsBusy(true);
    setMessage(null);
    try {
      const stats = await api.ozon.getStoreStats();
      setStoreStats(stats);
      if (!stats.ok) setMessage({ kind: 'warn', text: stats.message });
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setStatsBusy(false);
    }
  };

  const switchStoreTab = (tab: 'add' | 'manage' | 'pricing') => {
    setStoreTab(tab);
    setMessage(null);
    if (tab === 'manage' && !storeStats) refreshStoreStats();
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!isAi && storeTab === 'add') {
        if (!form.shopName.trim()) throw new Error('请填写店铺名称。');
        if (!form.ozonClientId.trim()) throw new Error('请填写 Client ID。');
        if (!settings?.ozon.apiKeySet && !form.ozonApiKey.trim()) throw new Error('请填写 API 密钥。');
        if (!form.currencyCode.trim()) throw new Error('请选择货币类型。');
      }
      const patch = isAi
        ? {
            ai: {
              baseUrl: form.aiBaseUrl,
              model: form.aiModel,
              ...(form.aiApiKey.trim() ? { apiKey: form.aiApiKey.trim() } : {}),
            },
          }
        : storeTab === 'pricing'
          ? {
              pricing: {
                otherFeeRate: Number(form.otherFeePercent) / 100,
                targetProfitRate: Number(form.targetProfitPercent) / 100,
                labelFeeCny: Number(form.labelFeeCny),
                shippingSpeed: form.shippingSpeed as 'express' | 'standard' | 'economy',
                handoffMode: form.handoffMode as 'pickup' | 'door',
              },
            }
          : {
            ozon: {
              clientId: form.ozonClientId,
              shopName: form.shopName,
              currencyCode: form.currencyCode,
              isDefaultShop: form.isDefaultShop,
              note: form.note.slice(0, 200),
              defaultWarehouseId: form.warehouseId,
              ...(form.ozonApiKey.trim() ? { apiKey: form.ozonApiKey.trim() } : {}),
            },
          };
      const saved = await api.ozon.saveSettings(patch);
      setSettings(saved);
      setForm((prev) => ({ ...prev, aiApiKey: '', ozonApiKey: '' }));
      onClose();
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="ozon-backdrop compact" onClick={onClose}>
      <section className="ozon-settings-modal" onClick={(event) => event.stopPropagation()}>
        <header className="ozon-modal-head">
          <div>
            <span>全局配置</span>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
        </header>

        {message && <div className={`ozon-message ${message.kind}`}>{message.text}</div>}

        <div className="ozon-settings-body">
          {!isAi && (
            <div className="ozon-settings-tabs">
              <button className={storeTab === 'add' ? 'active' : ''} onClick={() => switchStoreTab('add')}>添加店铺</button>
              <button className={storeTab === 'manage' ? 'active' : ''} onClick={() => switchStoreTab('manage')}>店铺管理</button>
              <button className={storeTab === 'pricing' ? 'active' : ''} onClick={() => switchStoreTab('pricing')}>定价设置</button>
            </div>
          )}

          {isAi ? (
            <div className="ozon-form-grid" style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>AI 文本生成服务已内置，无需额外配置。</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '8px 0 0' }}>生图 API 配置将在后续版本开放。</p>
            </div>
          ) : storeTab === 'add' ? (
            <div className="ozon-store-form">
              <label>
                <span><b>*</b> 店铺名称</span>
                <input value={form.shopName} placeholder="请输入店铺名称" onChange={(e) => setForm({ ...form, shopName: e.target.value })} />
              </label>

              <label>
                <span><b>*</b> Client ID</span>
                <input value={form.ozonClientId} placeholder="请输入Client ID" onChange={(e) => setForm({ ...form, ozonClientId: e.target.value })} />
              </label>

              <label>
                <span><b>*</b> API密钥 {settings?.ozon.apiKeySet ? '（已保存）' : ''}</span>
                <input type="password" value={form.ozonApiKey} placeholder={settings?.ozon.apiKeySet ? '留空表示不修改' : '请输入API密钥'} onChange={(e) => setForm({ ...form, ozonApiKey: e.target.value })} />
              </label>

              <label>
                <span><b>*</b> 货币类型</span>
                <GlassSelect
                  value={form.currencyCode}
                  options={[
                    { value: 'CNY', label: 'CNY - 人民币' },
                    { value: 'USD', label: 'USD - 美元' },
                    { value: 'RUB', label: 'RUB - 卢布' },
                    { value: 'EUR', label: 'EUR - 欧元' },
                  ]}
                  onChange={(value) => setForm({ ...form, currencyCode: value })}
                />
              </label>

              <a className="ozon-store-help" href="https://seller.ozon.ru/app/settings/contracts" target="_blank" rel="noreferrer">
                查看店铺货币类型：https://seller.ozon.ru/app/settings/contracts
              </a>

              <label>
                <span>默认仓库 ID</span>
                <input value={form.warehouseId} placeholder="用于 /v2/products/stocks，未填则跳过库存更新" onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} />
              </label>

              <fieldset className="ozon-radio-group">
                <legend>默认店铺(默认上传产品的店铺)</legend>
                <label><input type="radio" checked={form.isDefaultShop} onChange={() => setForm({ ...form, isDefaultShop: true })} /> 是</label>
                <label><input type="radio" checked={!form.isDefaultShop} onChange={() => setForm({ ...form, isDefaultShop: false })} /> 否</label>
              </fieldset>

              <label>
                <span>备注</span>
                <textarea
                  value={form.note}
                  maxLength={200}
                  placeholder="请输入备注信息"
                  onChange={(e) => setForm({ ...form, note: e.target.value.slice(0, 200) })}
                />
                <small>{noteLength} / 200</small>
              </label>
            </div>
          ) : storeTab === 'manage' ? (
            <div className="ozon-store-manage">
              <div className="ozon-manage-toolbar">
                <div>
                  <strong>{settings?.ozon.shopName || '未命名店铺'}</strong>
                  <span>{settings?.ozon.clientId || '未绑定 Client ID'}</span>
                </div>
                <button className="glass-btn-secondary" disabled={statsBusy} onClick={refreshStoreStats}>
                  {statsBusy ? '刷新中...' : '刷新额度'}
                </button>
              </div>

              <div className="ozon-store-card">
                <div>
                  <span>店铺状态</span>
                  <strong className={settings?.ozon.apiKeySet && settings.ozon.clientId ? 'ready' : 'missing'}>
                    {settings?.ozon.apiKeySet && settings.ozon.clientId ? '已绑定' : '未完成绑定'}
                  </strong>
                </div>
                <div>
                  <span>货币类型</span>
                  <strong>{settings?.ozon.currencyCode || '-'}</strong>
                </div>
                <div>
                  <span>默认店铺</span>
                  <strong>{settings?.ozon.isDefaultShop ? '是' : '否'}</strong>
                </div>
                <div>
                  <span>默认仓库</span>
                  <strong>{settings?.ozon.defaultWarehouseId || '未配置'}</strong>
                </div>
                <div>
                  <span>今日还能上架</span>
                  <strong className='quota-number'>
                    {storeStats?.quota?.remaining != null ? `${storeStats.quota.remaining} 个`
                      : storeStats?.quotaStatus === 'not_supported' ? '暂未支持'
                      : storeStats?.quotaStatus === 'not_found' ? '未返回'
                      : storeStats?.quotaStatus === 'error' ? '查询失败'
                      : '待返回'}
                  </strong>
                </div>
              </div>

              <div className="ozon-quota-panel">
                <h4>额度详情</h4>
                <p>{storeStats?.message || '点击"刷新额度"查询 Ozon 店铺今日上架额度。'}</p>
                {storeStats?.quota && (
                  <div className="ozon-quota-grid">
                    <span>今日额度 <strong>{storeStats.quota.limit ?? '不限'}</strong></span>
                    <span>今日已用 <strong>{storeStats.quota.used ?? '-'}</strong></span>
                    <span>今日剩余 <strong>{storeStats.quota.remaining ?? '-'}</strong></span>
                    {storeStats.quota.totalLimit != null && <span>总上限 <strong>{storeStats.quota.totalLimit}</strong></span>}
                    {storeStats.quota.totalUsage != null && <span>总已用 <strong>{storeStats.quota.totalUsage}</strong></span>}
                  </div>
                )}
                {storeStats?.connection && (
                  <small style={{ display: 'block', marginTop: 6 }}>
                    接口：{storeStats.connection.endpoint} — {storeStats.connection.message}
                  </small>
                )}
                {storeStats?.fetchedAt && <small>刷新时间：{new Date(storeStats.fetchedAt).toLocaleString()}</small>}
              </div>
            </div>
          ) : (
            <div className="ozon-store-form ozon-pricing-settings-form">
              <div className="ozon-pricing-fixed-note">
                <strong>固定规则</strong>
                <span>平台服务费 1% · 佣金按 Ozon 完整类目自动匹配最新 RFBS 表 · 币种 CNY</span>
              </div>

              <label>
                <span>其他费用率(%)</span>
                <input type="number" min="0" max="99.99" step="0.01" value={form.otherFeePercent} onChange={(e) => setForm({ ...form, otherFeePercent: e.target.value })} />
              </label>

              <label>
                <span>期望利润率(%)</span>
                <input type="number" min="0" step="0.01" value={form.targetProfitPercent} onChange={(e) => setForm({ ...form, targetProfitPercent: e.target.value })} />
              </label>

              <label>
                <span>贴单费(CNY)</span>
                <input type="number" min="0" step="0.01" value={form.labelFeeCny} onChange={(e) => setForm({ ...form, labelFeeCny: e.target.value })} />
              </label>

              <label>
                <span>CEL 运输速度</span>
                <GlassSelect
                  value={form.shippingSpeed}
                  options={[
                    { value: 'express', label: 'Express（约 5–10 天）' },
                    { value: 'standard', label: 'Standard（约 10–15 天）' },
                    { value: 'economy', label: 'Economy（约 15–25 天）' },
                  ]}
                  onChange={(value) => setForm({ ...form, shippingSpeed: value })}
                />
              </label>

              <label>
                <span>CEL 交接方式</span>
                <GlassSelect
                  value={form.handoffMode}
                  options={[
                    { value: 'pickup', label: '揽收点' },
                    { value: 'door', label: '上门' },
                  ]}
                  onChange={(value) => setForm({ ...form, handoffMode: value })}
                />
              </label>

              <div className="ozon-pricing-version-note">
                佣金数据：{settings?.pricing.commissionDataVersion || '-'} · CEL 数据：{settings?.pricing.shippingDataVersion || '-'}
              </div>
            </div>
          )}

          {(isAi || storeTab === 'add' || storeTab === 'pricing') && <div className="ozon-settings-actions">
            <span className="ozon-settings-status">
              {isAi
                ? (settings?.ai.apiKeySet ? 'DeepSeek Key 已保存' : 'DeepSeek Key 未保存')
                : storeTab === 'pricing'
                  ? '设置将用于后续自动生成的草稿'
                  : (settings?.ozon.apiKeySet ? 'Ozon API Key 已保存' : 'Ozon API Key 未保存')}
            </span>
            <button className="glass-btn-primary" disabled={busy} onClick={save}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>}
        </div>
      </section>
    </div>,
    document.body,
  );
}
