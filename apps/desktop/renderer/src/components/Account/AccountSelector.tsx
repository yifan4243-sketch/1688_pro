import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { getApi, AccountData } from '../../services/api';
import GlassSelect from '../Controls/GlassSelect';

interface Props {
  accounts: AccountData;
  activeProfile: string;
  onProfileChange: (profile: string) => void;
  onAccountsChanged: () => void | Promise<void>;
}

export default function AccountSelector({ accounts, activeProfile, onProfileChange, onAccountsChanged }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [alias, setAlias] = useState('');
  const [profile, setProfile] = useState('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const api = getApi();

  const statusMap: Record<string, string> = {
    logged_in: '已登录', not_logged_in: '未登录', risk_control: '风控中',
    busy: '占用中', profile_busy: '占用中', network_error: '网络错误',
    error: '异常', failed: '异常', timeout: '超时', cancelled: '已取消', unknown: '未知',
  };

  const openAdd = async () => {
    setAlias(''); setNote(''); setMsg('');
    try { setProfile(await api.accounts.suggestProfileName()); } catch { setProfile(''); }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!alias.trim()) { setMsg('账号备注名不能为空'); return; }
    if (!profile.trim()) { setMsg('Profile ID 不能为空'); return; }
    try {
      await api.accounts.add({ profile: profile.trim(), alias: alias.trim(), note: note.trim() });
      setShowModal(false); onAccountsChanged();
    } catch (e) { setMsg((e as Error).message); }
  };

  const handleLogin = async (p: string) => {
    if (!p || loginBusy) return;
    setLoginBusy(true);
    setMsg('正在登录...');
    try {
      await api.accounts.login(p);
      await api.accounts.refreshStatus(p);
      await onAccountsChanged();
      setMsg('登录完成');
    }
    catch (e) { setMsg((e as Error).message || '登录失败'); }
    finally { setLoginBusy(false); }
  };

  const openProfilesInTerminal = async (profiles: string[], label: string) => {
    const uniqueProfiles = Array.from(new Set(profiles.map(String).map((s) => s.trim()).filter(Boolean))).slice(0, 3);
    console.log('[batch-login]', label, uniqueProfiles);

    if (uniqueProfiles.length === 0) {
      setMsg('没有可登录的账号，请先新增登录账号。');
      return;
    }
    if (uniqueProfiles.length < 2 && label.includes('同时')) {
      setMsg(`当前只找到 ${uniqueProfiles.length} 个账号：${uniqueProfiles.join('、')}。如需同时登录两个账号，请先新增第二个账号。`);
    }
    try {
      const result = await api.accounts.loginManyInTerminal(uniqueProfiles);
      console.log('[batch-login] result', result);
      setMsg(`已打开 ${result.openedCount} 个登录终端：${(result.openedProfiles || uniqueProfiles).join('、')}。请分别完成登录，完成后点击刷新状态。`);
    } catch (e) {
      setMsg((e as Error).message || '打开登录终端失败');
    }
  };

  const handleLoginCurrent = () => openProfilesInTerminal([activeProfile], '登录当前账号');
  const handleLoginAll = () => {
    const profiles = accounts.accounts.map((a) => a.profile).filter(Boolean).slice(0, 3);
    openProfilesInTerminal(profiles, '同时登录全部账号');
  };
  const handleLoginNotLoggedIn = () => {
    const profiles = accounts.accounts.filter((a) => a.status !== 'logged_in').map((a) => a.profile).filter(Boolean).slice(0, 3);
    openProfilesInTerminal(profiles, '同时登录未登录账号');
  };

  return (
    <div className="glass-panel-card">
      <h2>1688账号档案</h2>
      <div className="form-field">
        <GlassSelect
          className="glass-select"
          value={activeProfile}
          options={accounts.accounts.map((a) => ({
            value: a.profile,
            label: `${a.alias} ｜ ${a.profile} ｜ ${statusMap[a.status] || a.status}`,
          }))}
          onChange={onProfileChange}
        />
      </div>
      <div className="form-field" style={{ flexDirection: 'row', gap: 8 }}>
        <button type="button" className="glass-btn-secondary" onClick={openAdd} style={{ flex: 1 }}>新增登录账号</button>
        <button type="button" className="glass-btn-secondary" disabled={loginBusy} onClick={handleLoginCurrent} style={{ flex: 1 }}>
          {loginBusy ? '登录中...' : '登录当前账号'}
        </button>
      </div>
      <div className="form-field" style={{ flexDirection: 'row', gap: 8 }}>
        <button type="button" className="glass-btn-secondary" onClick={handleLoginAll} style={{ flex: 1 }}>同时登录全部账号</button>
        <button type="button" className="glass-btn-secondary" onClick={handleLoginNotLoggedIn} style={{ flex: 1 }}>同时登录未登录账号</button>
      </div>
      {msg && <p className={`account-inline-message ${loginBusy ? 'loading' : ''}`}>{msg}</p>}

      {showModal && createPortal(
        <div className="modal-backdrop account-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="modal glass-panel-card account-add-modal">
            <h3>新增登录账号</h3>
            <div className="form-field">
              <label className="form-label">账号备注名</label>
              <input className="glass-input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="例如：张三-主采集号" />
            </div>
            <div className="form-field">
              <label className="form-label">Profile ID</label>
              <input className="glass-input" value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="自动生成，可手动修改" />
            </div>
            <div className="form-field">
              <label className="form-label">备注</label>
              <input className="glass-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填" />
            </div>
            {msg && <p className="alert info">{msg}</p>}
            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button className="glass-btn-ghost" onClick={() => setShowModal(false)}>取消</button>
              <button className="glass-btn-primary" onClick={handleSave}>保存</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
