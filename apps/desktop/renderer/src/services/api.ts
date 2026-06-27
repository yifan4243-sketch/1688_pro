// Typed wrapper for window.desktopApi exposed by Electron preload.

export interface AccountInfo {
  profile: string;
  alias: string;
  note: string;
  createdAt: string;
  lastUsedAt: string;
  lastLoginAt: string | null;
  status: string;
}

export interface AccountData {
  activeProfile: string;
  accounts: AccountInfo[];
}

export interface CommandOption {
  name: string;
  flag: string;
  label: string;
  type: string;
  default?: unknown;
  values?: { value: string; label: string }[];
  required?: boolean;
}

export interface CommandDef {
  id: string;
  group: string;
  label: string;
  positional: { name: string; label: string; required?: boolean; multiline?: boolean; array?: boolean }[];
  options: CommandOption[];
  write: boolean;
  checkoutConfirm?: boolean;
  resultType: string;
  argvPreview: string;
}

export interface CommandGroup {
  id: string;
  label: string;
}

export interface CommandRegistry {
  groups: CommandGroup[];
  commands: Record<string, CommandDef>;
}

export interface CommandPayload {
  commandId: string;
  args: Record<string, string>;
  options: Record<string, unknown>;
  profile: string;
  confirmed?: boolean;
  prepareRunId?: string;
}

export interface CommandRecord {
  runId: string;
  commandId: string;
  resultType: string;
  status: string;
  argv: string[];
  stdoutJson: unknown;
  stderrText: string;
  error: { status: string; message: string; stderr: string } | null;
  startedAt: string;
}

export interface RuntimeStatus {
  profile: string;
  daemon: { status: string; stdoutJson?: { running?: boolean } } | null;
  account: { status: string; stdoutJson?: { loggedIn?: boolean; nick?: string; memberId?: string } } | null;
}

export interface CliInfo {
  cliPath: string;
  cliExists: boolean;
  rootDir: string;
  isPackaged: boolean;
}

// Raw window.desktopApi shape
const api = (window as unknown as { desktopApi?: DesktopApi }).desktopApi;

interface DesktopApi {
  commands: {
    getRegistry: () => Promise<CommandRegistry>;
    run: (payload: CommandPayload) => Promise<CommandRecord>;
    cancel: (runId: string) => Promise<{ ok: boolean }>;
    getHistory: (query: { limit?: number }) => Promise<CommandRecord[]>;
  };
  accounts: {
    list: () => Promise<AccountData>;
    add: (params: { profile: string; alias: string; note?: string }) => Promise<AccountData>;
    update: (profile: string, params: { alias?: string; note?: string }) => Promise<AccountData>;
    remove: (profile: string) => Promise<AccountData>;
    setActive: (profile: string) => Promise<AccountData>;
    login: (profile: string) => Promise<CommandRecord & { accountStatus: string }>;
    refreshStatus: (profile: string) => Promise<{ profile: string; status: string }>;
    suggestProfileName: () => Promise<string>;
  };
  runtime: {
    getStatus: (profile: string) => Promise<RuntimeStatus>;
    doctor: (profile: string) => Promise<{ ok: boolean }>;
    getCliInfo: () => Promise<CliInfo>;
  };
}

export function getApi(): DesktopApi {
  if (!api) throw new Error('desktopApi 不可用：请在 Electron 环境中运行。');
  return api;
}
