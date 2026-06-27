import React, { useEffect, useState } from 'react';
import { getApi, CommandRegistry, AccountData, RuntimeStatus, CliInfo, CommandRecord } from './services/api';
import AccountSelector from './components/Account/AccountSelector';
import RuntimeStatusPanel from './components/Runtime/RuntimeStatusPanel';
import CommandPanel from './components/Commands/CommandPanel';
import HistoryPanel from './components/History/HistoryPanel';

export default function App() {
  const [registry, setRegistry] = useState<CommandRegistry | null>(null);
  const [accounts, setAccounts] = useState<AccountData | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [cliInfo, setCliInfo] = useState<CliInfo | null>(null);
  const [activeProfile, setActiveProfile] = useState('default');
  const [history, setHistory] = useState<CommandRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const loadHistory = async () => {
    const items = await api.commands.getHistory({ limit: 12 });
    setHistory(items);
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
          onAccountsChanged={() => api.accounts.list().then(setAccounts)}
        />

        <RuntimeStatusPanel
          runtime={runtime}
          cliInfo={cliInfo}
          onRefresh={handleRefreshRuntime}
        />
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">1688 CLI 全功能接入</p>
            <h2>1688 to Ozon Studio</h2>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={handleRefreshRuntime}>刷新状态</button>
            <button className="ghost-button" onClick={loadHistory}>历史记录</button>
          </div>
        </header>

        <section className="content-grid">
          <CommandPanel
            registry={registry}
            activeProfile={activeProfile}
            accounts={accounts}
            onHistoryRefresh={loadHistory}
          />

          <aside className="ozon-panel">
            <div className="section-head">
              <h3>Ozon 上架卡片</h3>
              <span>本轮预留</span>
            </div>
            <article className="ozon-draft-card">
              <div className="draft-state ready">1688 已接入</div>
              <h4>Ozon / DeepSeek 下一步</h4>
              <p>本轮只接 1688 CLI。下一轮接入 DeepSeek 生成俄语标题、描述，对接 Ozon ProductAPI 上架。</p>
            </article>

            <HistoryPanel history={history} />
          </aside>
        </section>
      </main>
    </div>
  );
}
