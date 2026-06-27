import React, { useState } from 'react';
import { getApi, AccountData } from '../../services/api';

interface Props {
  accounts: AccountData;
  activeProfile: string;
  onProfileChange: (profile: string) => void;
  onAccountsChanged: () => void;
}

export default function AccountSelector({ accounts, activeProfile, onProfileChange, onAccountsChanged }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [alias, setAlias] = useState('');
  const [profile, setProfile] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');

  const api = getApi();

  const statusMap: Record<string, string> = {
    logged_in: '已登录',
    not_logged_in: '未登录',
    risk_control: '风控中',
    busy: '占用中',
    profile_busy: '占用中',
    network_error: '网络错误',
    error: '异常',
    failed: '异常',
    timeout: '超时',
    cancelled: '已取消',
    unknown: '未知',
  };

  const openAdd = async () => {
    setAlias('');
    setNote('');
    setMsg('');
    try {
      setProfile(await api.accounts.suggestProfileName());
    } catch {
      setProfile('');
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!alias.trim()) { setMsg('账号备注名不能为空'); return; }
    if (!profile.trim()) { setMsg('Profile ID 不能为空'); return; }
    try {
      await api.accounts.add({ profile: profile.trim(), alias: alias.trim(), note: note.trim() });
      setShowModal(false);
      onAccountsChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const handleLogin = async (p: string) => {
    setMsg('正在登录...');
    try {
      await api.accounts.login(p);
      await api.accounts.refreshStatus(p);
      onAccountsChanged();
      setMsg('登录完成');
    } catch (e) {
      setMsg((e as Error).message || '登录失败');
    }
  };

  return (
    <section className="status-panel">
      <h2>1688账号档案</h2>
      <select
        value={activeProfile}
        onChange={(e) => onProfileChange(e.target.value)}
        className="profile-select"
      >
        {accounts.accounts.map((a) => (
          <option key={a.profile} value={a.profile}>
            {a.alias} ｜ {a.profile} ｜ {statusMap[a.status] || a.status}
          </option>
        ))}
      </select>
      <div className="account-actions">
        <button className="ghost-button" onClick={openAdd}>新增登录账号</button>
        <button className="ghost-button" onClick={() => handleLogin(activeProfile)}>
          登录 / 重新登录
        </button>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="modal">
            <h3>新增登录账号</h3>
            <label className="field">
              <span>账号备注名</span>
              <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="例如：张三-主采集号" />
            </label>
            <label className="field">
              <span>Profile ID</span>
              <input value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="自动生成，可手动修改" />
            </label>
            <label className="field">
              <span>备注</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填" />
            </label>
            {msg && <p className="alert info">{msg}</p>}
            <div className="modal-actions">
              <button className="ghost-button" onClick={() => setShowModal(false)}>取消</button>
              <button className="primary-button" onClick={handleSave}>保存</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
