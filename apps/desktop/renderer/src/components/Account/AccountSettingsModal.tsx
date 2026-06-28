import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { getApi, AccountData } from '../../services/api';

interface Props {
  accounts: AccountData;
  activeProfile: string;
  open: boolean;
  onClose: () => void;
  onAccountsChanged: () => void;
  onProfileChange: (profile: string) => void;
}

const statusLabel: Record<string, string> = { logged_in: '已登录', not_logged_in: '未登录', login_opened: '待验证', verifying: '验证中', login_failed: '登录失败', busy: '占用中', profile_busy: '占用中', risk_control: '风控中', unknown: '未知' };
const statusColor: Record<string, string> = { logged_in: '#16a34a', not_logged_in: '#dc2626', login_opened: '#2563eb', verifying: '#2563eb', login_failed: '#dc2626', busy: '#d97706', profile_busy: '#d97706', risk_control: '#ea580c', unknown: '#888' };

export default function AccountSettingsModal({ accounts, activeProfile, open, onClose, onAccountsChanged, onProfileChange }: Props) {
  const [msg, setMsg] = useState('');
  const api = getApi();

  const handleLoginBrowser = async (profile: string) => {
    setMsg(`正在为 ${profile} 打开登录浏览器...`);
    try {
      await api.accounts.loginBrowser(profile);
      setMsg(`已为 ${profile} 打开登录浏览器，待验证。请完成登录后点击刷新状态。`);
    } catch (e) { setMsg((e as Error).message); }
  };

  const handleRefreshOne = async (profile: string) => {
    setMsg(`正在验证 ${profile}...`);
    try {
      await api.accounts.refreshStatus(profile);
      await onAccountsChanged();
      setMsg(`${profile} 状态已更新。`);
    } catch (e) { setMsg((e as Error).message); }
  };

  const handleRefreshAll = async () => {
    setMsg('正在验证全部账号...');
    for (const a of accounts.accounts) {
      try { await api.accounts.refreshStatus(a.profile); await new Promise((r) => setTimeout(r, 400)); } catch {}
    }
    await onAccountsChanged();
    setMsg('全部账号状态已更新。');
  };

  const handleLoginAllBrowser = async () => {
    const profiles = accounts.accounts.map((a) => a.profile).filter(Boolean).slice(0, 3);
    try {
      const r = await api.accounts.loginManyBrowser(profiles);
      setMsg(`已打开 ${r.openedCount} 个登录浏览器。请完成登录后刷新状态。`);
    } catch (e) { setMsg((e as Error).message); }
  };

  if (!open) return null;

  return createPortal(
    <div className="history-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="history-modal" style={{ width: 'min(860px, calc(100vw - 64px))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>1688 账号管理</h3>
          <button className="glass-btn-ghost" onClick={onClose}>关闭</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <button className="glass-btn-secondary" onClick={() => { onClose(); }} style={{ fontSize: 12 }}>新增账号</button>
          <button className="glass-btn-secondary" onClick={handleLoginAllBrowser} style={{ fontSize: 12 }}>全部打开登录浏览器</button>
          <button className="glass-btn-secondary" onClick={handleRefreshAll} style={{ fontSize: 12 }}>全部刷新状态</button>
        </div>

        {msg && <p className="alert info" style={{ fontSize: 12 }}>{msg}</p>}

        <div style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
          {accounts.accounts.map((a) => (
            <div key={a.profile} className="history-row" style={{ gridTemplateColumns: '1fr 80px auto', cursor: 'default', fontSize: 13, padding: '12px 14px', marginBottom: 6 }}>
              <div>
                <strong>{a.alias}</strong>
                <span style={{ color: '#888', marginLeft: 8, fontSize: 11 }}>{a.profile}</span>
                {a.profile === activeProfile && <span className="status-badge" style={{ marginLeft: 6 }}>当前</span>}
                {a.note && <span style={{ display: 'block', fontSize: 11, color: '#888', marginTop: 2 }}>{a.note}</span>}
              </div>
              <span style={{ color: statusColor[a.status] || '#888', fontWeight: 600, fontSize: 12 }}>
                {statusLabel[a.status] || '未知'}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {a.profile !== activeProfile && (
                  <button className="glass-btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { onProfileChange(a.profile); }}>切换</button>
                )}
                <button className="glass-btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleLoginBrowser(a.profile)}>登录</button>
                <button className="glass-btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => handleRefreshOne(a.profile)}>刷新</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
