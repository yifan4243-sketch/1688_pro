import React, { useEffect, useMemo, useState } from 'react';
import { getApi, CommandRegistry, AccountData, RuntimeStatus, CliInfo, CommandRecord } from './services/api';
import AccountSelector from './components/Account/AccountSelector';
import RuntimeStatusPanel from './components/Runtime/RuntimeStatusPanel';
import CommandPanel from './components/Commands/CommandPanel';
import HistoryModal from './components/History/HistoryModal';
import HistoryDetailModal from './components/History/HistoryDetailModal';
import ProductHistoryModal from './components/History/ProductHistoryModal';
import OzonSettingsModal from './components/Ozon/OzonSettingsModal';
import AccountSettingsModal from './components/Account/AccountSettingsModal';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/tokens.css';
import './styles/controls.css';
import './styles/panels.css';
import './App.css';

type DeepCollectSidebarTaskStatus = 'queued' | 'collecting' | 'success' | 'failed';

interface DeepCollectSidebarTask {
  key: string;
  offerId?: string;
  title?: string;
  image?: string;
  status: DeepCollectSidebarTaskStatus;
  message?: string;
  profile?: string;
  attempt?: number;
  createdAt: string;
  updatedAt?: string;
  finishedAt?: string;
}

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
  const [workspaceView, setWorkspaceView] = useState<'1688' | 'ozon'>('1688');
  const [runtimeStatusOpen, setRuntimeStatusOpen] = useState(false);
  const [deepTasks, setDeepTasks] = useState<DeepCollectSidebarTask[]>([]);
  const [deepTaskFilter, setDeepTaskFilter] = useState<'all' | 'success' | 'queued' | 'failed'>('all');
  const deepTaskCounts = useMemo(() => {
    const queued = deepTasks.filter((t) => t.status === 'queued' || t.status === 'collecting').length;
    const success = deepTasks.filter((t) => t.status === 'success').length;
    const failed = deepTasks.filter((t) => t.status === 'failed').length;
    return { all: deepTasks.length, queued, success, failed };
  }, [deepTasks]);
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
    const items = await api.productHistory.list(500);
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
      <aside className="side-nav app-side-switcher">
        <div className="side-app-buttons">
          <button type="button" className={`side-app-button ${workspaceView === '1688' ? 'active' : ''}`} onClick={() => setWorkspaceView('1688')} aria-label="1688">
            <img src="/nav/1688.png" alt="1688" />
          </button>
          <button type="button" className={`side-app-button ${workspaceView === 'ozon' ? 'active' : ''}`} onClick={() => setWorkspaceView('ozon')} aria-label="Ozon">
            <img src="/nav/ozon.png" alt="Ozon" />
          </button>
        </div>

        <div className="deep-task-sidebar">
          <div className="deep-task-sidebar-head">
            <span className="deep-task-sidebar-title">采集任务列表</span>
          </div>
          <div className="deep-task-filters">
            <button className={deepTaskFilter === 'all' ? 'active' : ''} onClick={() => setDeepTaskFilter('all')}> <span>全部</span> <strong>{deepTaskCounts.all}</strong> </button>
            <button className={deepTaskFilter === 'success' ? 'active' : ''} onClick={() => setDeepTaskFilter('success')}> <span>已完成</span> <strong>{deepTaskCounts.success}</strong> </button>
            <button className={deepTaskFilter === 'queued' ? 'active' : ''} onClick={() => setDeepTaskFilter('queued')}> <span>排队中</span> <strong>{deepTaskCounts.queued}</strong> </button>
            <button className={deepTaskFilter === 'failed' ? 'active' : ''} onClick={() => setDeepTaskFilter('failed')}> <span>失败</span> <strong>{deepTaskCounts.failed}</strong> </button>
          </div>
          {(() => {
            const filtered = deepTasks.filter((t) => {
              if (deepTaskFilter === 'all') return true;
              if (deepTaskFilter === 'success') return t.status === 'success';
              if (deepTaskFilter === 'queued') return t.status === 'queued' || t.status === 'collecting';
              if (deepTaskFilter === 'failed') return t.status === 'failed';
              return true;
            });
            return (
              <>
                {filtered.length === 0 ? (
                  <div className="deep-task-empty">暂无任务</div>
                ) : (
                  <div className="deep-task-list custom-scrollbar">
                    {filtered.map((task) => (
                      <div key={task.key} className={`deep-task-item ${task.status}`} title={task.message || ''}>
                        {task.image ? (
                          <img className="deep-task-thumb" src={task.image} alt="" />
                        ) : (
                          <div className="deep-task-thumb placeholder" />
                        )}
                        <div className="deep-task-info">
                          <div className="deep-task-title">{task.title || task.offerId || '未命名商品'}</div>
                          <div className="deep-task-meta">
                            <span className={`deep-task-status ${task.status}`}>
                              {task.status === 'collecting' ? '采集中' : task.status === 'queued' ? '排队中' : task.status === 'success' ? '已完成' : '失败'}
                            </span>
                            <span className="deep-task-time">{new Date(task.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                          </div>
                          {task.message && <div className="deep-task-message">{task.message}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{workspaceView === '1688' ? '1688 CLI 全功能接入' : 'Ozon 工作台'}</p>
            <h2>{workspaceView === '1688' ? '1688 to Ozon Studio' : 'Ozon Studio'}</h2>
          </div>
          <div className="topbar-actions">
            <button className="glass-btn-secondary" onClick={() => setRuntimeStatusOpen(true)}>运行状态</button>
            <button className="glass-btn-secondary topbar-config-btn" onClick={() => setOzonSettingsOpen('ai')}>AI 设置</button>
            <button className="glass-btn-secondary topbar-config-btn" onClick={() => setOzonSettingsOpen('store')}>Ozon 店铺</button>
            <button className="glass-btn-secondary topbar-config-btn" onClick={() => setAccountSettingsOpen(true)}>1688账号</button>
            <button className="glass-btn-secondary" onClick={openRecentTasks}>最近任务</button>
            <button className="glass-btn-secondary" onClick={openProductHistory}>历史记录</button>
          </div>
        </header>

        <div className="workspace-inner">
          {workspaceView === '1688' ? (
            <ErrorBoundary>
              <CommandPanel
                registry={registry}
                activeProfile={activeProfile}
                accounts={accounts}
                onHistoryRefresh={refreshRecentTasks}
                onDeepTasksChange={setDeepTasks}
              />
            </ErrorBoundary>
          ) : (
            <div className="ozon-blank-page">
              <div className="ozon-blank-card">
                <h3>Ozon 工作台</h3>
                <p>该页面暂未接入，后续用于 Ozon 上架、草稿、店铺任务。</p>
              </div>
            </div>
          )}
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

      {runtimeStatusOpen && (
        <div className="runtime-status-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setRuntimeStatusOpen(false); }}>
          <div className="runtime-status-modal">
            <div className="runtime-status-modal-header">
              <h3>运行状态</h3>
              <button className="glass-btn-ghost" onClick={() => setRuntimeStatusOpen(false)}>关闭</button>
            </div>
            <RuntimeStatusPanel
              runtime={runtime} cliInfo={cliInfo} onRefresh={handleRefreshRuntime}
              accounts={accounts.accounts} activeProfile={activeProfile} embedded
            />
          </div>
        </div>
      )}

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
