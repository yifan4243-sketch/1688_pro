# 1688 to Ozon Desktop UI Design

第一步目标：基于当前 `1688-cli` 能力新增桌面端工作台 UI。此阶段只实现可视化桌面壳与交互骨架，不执行真实 1688/Ozon 写操作。

## Existing CLI Capabilities

- 商品采集：`search`、`search --deeppro`、`offer <ids...> --pro`、`research`、`compare`、`image-search`。
- 供应商采集：`supplier search`、`supplier research`、`supplier inspect`。
- 账号与会话：`login`、`whoami`、`doctor`、`daemon start|stop|status|reload`、`profile list|status`。
- 买家工作流：`cart list|add|remove`、`checkout prepare|confirm`、`order list|get|logistics`。
- 沟通工作流：`seller inquire`、`seller messages`、`seller chat`、`inbox`。
- 输出能力：TTY 文本、`--json`、`--pretty`、`--get`、`--pick`、JSONL、CSV、`--output`。
- 风控约定：exit 3 表示登录问题；exit 4 表示风控/验证，需要 headed 手动处理。

## Desktop UI Scope

- 左侧：工作流导航、运行状态（CLI、Profile、Daemon）。
- 中间：采集任务配置和 1688 商品结果卡片。
- 右侧：Ozon 上架卡片、DeepSeek 生成、Ozon MCP 接入的预留区。
- 结果卡片沿用旧项目信息架构：商品主图、标题、状态、SKU 数、价格、库存、属性数、尺寸重量、缺失字段、SKU 子行。

## 1688 账号档案管理

桌面端现在支持本地 1688 账号档案管理，存储在 Electron `userData` 目录下的 `accounts.json`：

- `profile`：技术 ID（如 `default`、`buyer_01`），与 CLI `--profile` 参数一一对应，不可随意修改。
- `alias`：员工可读备注名（如 `张三-主采集号`），可随时修改，不影响 CLI 底层逻辑。
- `activeProfile`：当前选中的账号 profile，所有命令自动带上 `--profile <value>`。
- 员工通过左侧下拉框选择账号，无需手填 Profile。
- 新增账号时自动生成建议 profile ID（如 `buyer_01`、`buyer_02`）。
- 账号删除只移除本地 `accounts.json` 配置，不删除 `~/.1688` 下的真实登录数据。
- 本轮只管理桌面端账号列表，不涉及真实 1688 登录数据的删除或迁移。

## Deferred Integration

- 将"开始采集"接入 `1688 search --deeppro --json` 和 `1688 offer <ids...> --pro --json`。
- 将 1688 商品卡片转换成 Ozon 上架卡片。
- 接入 DeepSeek 生成俄语标题、描述、富文本和搜索词。
- 接入 Ozon MCP/ProductAPI 上架。
