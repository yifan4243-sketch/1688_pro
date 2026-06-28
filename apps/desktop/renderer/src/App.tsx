import React, { useEffect, useState } from 'react';
import { getApi, CommandRegistry, AccountData, RuntimeStatus, CliInfo, CommandRecord } from './services/api';
import AccountSelector from './components/Account/AccountSelector';
import RuntimeStatusPanel from './components/Runtime/RuntimeStatusPanel';
import CommandPanel from './components/Commands/CommandPanel';
import HistoryModal from './components/History/HistoryModal';
import HistoryDetailModal from './components/History/HistoryDetailModal';
import ProductHistoryModal from './components/History/ProductHistoryModal';
import OzonSettingsModal from './components/Ozon/OzonSettingsModal';
import AccountSettingsModal from './components/Account/AccountSettingsModal';
import './styles/tokens.css';
import './styles/controls.css';
import './styles/panels.css';
import './App.css';

export default function App() {
  const [registry, setRegistry] = useState<CommandRegistry | null>(null);
  const [accounts, setAccounts] = useState<AccountData | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [cliInfo, setCliInfo] = useState<CliInfo | null>(null);
  const [activeProfile, setActiveProfile] = useState('default');
  const [history, setHistory] = useState<CommandRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recentOpen, setRecentOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<CommandRecord | null>(null);
  const [productHistoryOpen, setProductHistoryOpen] = useState(false);
  const [ozonSettingsOpen, setOzonSettingsOpen] = useState<'ai' | 'store' | null>(null);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [productItems, setProductItems] = useState<Array<{ offerId: string; title: string; price: string; image: string; url: string; collectedAt: string; raw?: unknown }>>([]);

  const api = getApi();

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [reg, acc, rt, cli] = await Promise.all([
        api.commands.getRegistry(),
        api.accounts.list(),
        api.runtime.getStatus(activeProfile),
        api.runtime.getCliInfo(),
      ]);
      setRegistry(reg);
      setAccounts(acc);
      setActiveProfile(acc.activeProfile);
      setRuntime(rt);
      setCliInfo(cli);
    } catch (e) {
      setError((e as Error).message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const handleAccountChange = async (profile: string) => {
    await api.accounts.setActive(profile);
    setActiveProfile(profile);
    const acc = await api.accounts.list();
    setAccounts(acc);
    const rt = await api.runtime.getStatus(profile);
    setRuntime(rt);
  };

  const handleRefreshRuntime = async () => {
    const rt = await api.runtime.getStatus(activeProfile);
    setRuntime(rt);
  };

  const openRecentTasks = async () => {
    const items = await api.commands.getHistory({ limit: 8 });
    setHistory(items);
    setRecentOpen(true);
  };

  const refreshRecentTasks = async () => {
    const items = await api.commands.getHistory({ limit: 8 });
    setHistory(items);
  };

  const openProductHistory = async () => {
    const items = await api.productHistory.list(50);
    setProductItems(items);
    setProductHistoryOpen(true);
  };

  const openHistory = async () => {
    const items = await api.commands.getHistory({ limit: 50 });
    setHistory(items);
    setHistoryOpen(true);
  };

  if (loading) {
    return <div className="app-loading">正在启动 1688 to Ozon Studio...</div>;
  }

  if (!registry || !accounts) {
    return (
      <div className="app-error">
        <h2>启动失败</h2>
        <p>{error || '无法连接桌面端服务。请重新启动应用。'}</p>
        <button onClick={loadAll}>重试</button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-block">
          <div className="brand-mark">1688</div>
          <div>
            <h1>1688 to Ozon</h1>
            <p>Desktop Studio</p>
          </div>
        </div>

        <AccountSelector
          accounts={accounts}
          activeProfile={activeProfile}
          onProfileChange={handleAccountChange}
          onAccountsChanged={async () => {
            const acc = await api.accounts.list();
            setAccounts(acc);
            const rt = await api.runtime.getStatus(activeProfile);
            setRuntime(rt);
          }}
        />

        <RuntimeStatusPanel
          runtime={runtime}
          cliInfo={cliInfo}
          onRefresh={handleRefreshRuntime}
          accounts={accounts.accounts}
          activeProfile={activeProfile}
        />
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">1688 CLI 全功能接入</p>
            <h2>1688 to Ozon Studio</h2>
          </div>
          <div className="topbar-actions">
            <button className="glass-btn-secondary topbar-config-btn" onClick={() => setOzonSettingsOpen('ai')}>AI 设置</button>
            <button className="glass-btn-secondary topbar-config-btn" onClick={() => setOzonSettingsOpen('store')}>Ozon 店铺</button>
            <button className="glass-btn-secondary topbar-config-btn" onClick={() => setAccountSettingsOpen(true)}>1688账号</button>
            <button className="glass-btn-secondary" onClick={handleRefreshRuntime}>刷新状态</button>
            <button className="glass-btn-secondary" onClick={openRecentTasks}>最近任务</button>
            <button className="glass-btn-secondary" onClick={openProductHistory}>历史记录</button>
          </div>
        </header>

        <div className="workspace-inner">
          <CommandPanel
            registry={registry}
            activeProfile={activeProfile}
            accounts={accounts}
            onHistoryRefresh={refreshRecentTasks}
          />
        </div>
      </main>

      <HistoryModal
        title="最近任务"
        history={history.slice(0, 8)}
        open={recentOpen}
        onClose={() => setRecentOpen(false)}
        onSelect={(r) => { setRecentOpen(false); setDetailRecord(r); }}
        compact
      />

      <HistoryModal
        title="历史记录"
        history={history}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelect={(r) => { setHistoryOpen(false); setDetailRecord(r); }}
      />

      <HistoryDetailModal
        record={detailRecord}
        onClose={() => setDetailRecord(null)}
      />

      <ProductHistoryModal
        items={productItems}
        open={productHistoryOpen}
        onClose={() => setProductHistoryOpen(false)}
      />

      <OzonSettingsModal
        mode={ozonSettingsOpen || 'ai'}
        open={ozonSettingsOpen !== null}
        onClose={() => setOzonSettingsOpen(null)}
      />

      <AccountSettingsModal
        accounts={accounts}
        activeProfile={activeProfile}
        open={accountSettingsOpen}
        onClose={() => setAccountSettingsOpen(false)}
        onAccountsChanged={() => api.accounts.list().then(setAccounts) as Promise<void>}
        onProfileChange={handleAccountChange}
      />
    </div>
  );
}
