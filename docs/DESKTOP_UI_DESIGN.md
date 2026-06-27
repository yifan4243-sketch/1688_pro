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

- 左侧：工作流导航、Profile、Daemon、CLI 状态。
- 中间：采集任务配置和 1688 商品结果卡片。
- 右侧：Ozon 上架卡片、DeepSeek 生成、Ozon MCP 接入的预留区。
- 结果卡片沿用旧项目信息架构：商品主图、标题、状态、SKU 数、价格、库存、属性数、尺寸重量、缺失字段、SKU 子行。

## Deferred Integration

- 将“开始采集”接入 `1688 search --deeppro --json` 和 `1688 offer <ids...> --pro --json`。
- 将 1688 商品卡片转换成 Ozon 上架卡片。
- 接入 DeepSeek 生成俄语标题、描述、富文本和搜索词。
- 接入 Ozon MCP/ProductAPI 上架。
