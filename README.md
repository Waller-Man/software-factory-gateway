# 软件工厂 HugeGraph 只读网关

运行在 DeepSeek Harness（DSH）中的后端插件，为网页、其他插件和 AI 工具提供统一的 HugeGraph 查询服务。没有独立网站，也不需要额外启动进程。

## 功能

- 查询能力树、逻辑 Agent、版本详情、相关关系和有界图快照。
- 按能力、关键词、登记状态、模型和开发人员筛选候选版本，支持分页。
- 分别返回逻辑描述和版本独立描述，缺省时不互相代替。
- 读取八大类字段定义，支持当前20项元数据及版本可选的数据集声明。
- 读取数据库中的公共数据集根位置，支持本地绝对路径或 HTTP/HTTPS 地址。
- 提供连接健康检查，以及共用读取逻辑的 Service、Remote 和 Tool。

插件只提供事实和筛选结果，不写数据库、不排名、不执行算法，也不检查、下载或打开数据集。

## 环境要求

当前版本 **0.1.3**，接口 **API 1.0**。此版本补齐组件配置入口，修复0.1.2组件名称无法点击的问题。

| 项目 | 要求 |
| --- | --- |
| DSH | 兼容的 `0.2.1-alpha.2`，包含组件配置表单与实时配置支持 |
| Node.js | 运行 DSH 的环境为24或以上 |
| HugeGraph | `1.7.0`，已有软件工厂 Schema 和业务数据 |

宿主提供 Cordis、Tool 和 Remote 等运行依赖。Gateway 可以独立安装，不要求 Manage 或 WebUI；需要可视化页面时再安装软件工厂 WebUI。插件不会创建数据库或迁移 Schema。

## 新电脑快速启动

### 1. 下载并安装

1. 启动 DSH 和已有的 HugeGraph 数据库，确认 DSH 网页可以登录。
2. 下载预编译安装包 `software-factory-gateway-0.1.3.zip`，解压到 **DSH 服务端电脑**的长期保留目录，如 `D:\DSH-Plugins\software-factory-gateway`。
3. 打开 DSH“插件 → 添加插件 → 安装第三方插件”，填写包含 `package.json` 的目录绝对路径。不要填写 ZIP 或 `lib` 子目录。
4. 启用插件包及“软件工厂 HugeGraph 只读网关”组件。

预编译包不需要用户编译或手工运行 `npm install`，DSH 安装器处理宿主依赖；不承诺完全离线安装。GitHub 的 Source code ZIP 是源码，不是安装包。安装后请保留解压目录。

### 2. 在组件内部填写连接

进入 **插件 → 插件包 → 包含的组件 → 软件工厂 HugeGraph 只读网关 → 配置**，填写并保存：

组件名称应为可点击按钮并带右箭头。若由0.1.2升级，更新安装目录后先重启DSH，再在浏览器按 `Ctrl+F5` 刷新；仅开关组件不能保证旧网页代码被替换。密码框留空表示保留原密码。

| 字段 | 示例／说明 |
| --- | --- |
| `baseUrl` | `http://127.0.0.1:18080`，数据库地址及端口；远程连接使用 HTTPS |
| `graphSpace` | `DEFAULT` |
| `graph` | `hugegraph` |
| `username` | 你的数据库用户名，必填 |
| `password` | 你的数据库密码，必填；使用 DSH 密码输入框，保存后不回显 |
| `timeoutMs` | 总超时，默认30000毫秒 |
| `requestTimeoutMs` | 单次请求超时，默认10000毫秒 |
| `maxConcurrent` | 最大并发，默认4 |

`127.0.0.1` 指运行 DSH 的电脑。地址不添加 REST 路径，插件不额外监听端口。**不需要 `.env`，组件表单也不填写数据集目录。**

表单与手动编辑使用同一份 DSH 组件配置。修改生效配置并被 DSH 成功加载后，表单会反映新值；支持热重载的宿主中，下一次读取使用新配置，旧连接上的未完成请求会取消。否则重启 DSH，网页必要时刷新。密码只用于后端连接，不进入查询结果、日志或安装包。

### 3. 检查连接

在 DSH 调用 `hugegraph_read`：

```json
{"action":"health"}
```

`ok: true` 且 `data.ready: true` 表示本次连接及业务 Schema 检查通过。再查询版本详情：

```json
{"action":"read","query":{"kind":"candidates","status":"enabled","limit":20,"detail":"full"}}
```

`enabled` 只表示登记状态，不表示业务 Tool 已安装或执行成功。检查网关无需运行真实算法。

## 数据集如何配置和读取

公共根位置保存在数据库固定节点 `config:software-factory` 的 `dataset_root` 属性。换电脑时由数据库管理员更新，Gateway 只读，不在插件表单重复填写。

```json
{"action":"read","query":{"kind":"factory_config"}}
```

结果明确区分已配置、未配置和配置异常。公共配置缺省不影响普通 Agent 查询，也不进入能力树或图快照。

每个版本可以在 `datasets_json` 中声明数据集，也可以不填。版本完整详情保留原文、解析结果及缺省／异常状态；路径和网址只作为资料返回，实际使用由执行插件处理。

## 接口与接入

| 入口 | 名称 |
| --- | --- |
| 后端服务 | `hugegraphRead`，供其他插件后端调用 |
| 网页 Remote | `hugegraphRead/health`、`hugegraphRead/snapshot`、`hugegraphRead/read`，沿用 DSH 认证 |
| AI 工具 | `hugegraph_read` |

服务提供 `health()`、`snapshot(options)`、`read(query)`。查询种类为 `capability_tree`、`node`、`agents`、`versions`、`candidates`、`field_groups`、`factory_config`。

列表默认50项、最多100项；描述和数据集等完整资料需要 `detail: "full"`。其他后端插件声明 `inject = ['hugegraphRead']` 和 `@software-factory/gateway: ^0.1.2` 的 peer 依赖；类型从 `@software-factory/gateway/types` 导入。

完整参数、返回结构、分页及 **TypeScript／Remote／Tool 示例**见 [接口文档](docs/gateway-api.md)。

## 更新与常见问题

- **从0.1.1升级**：在新版组件配置中填写连接一次；旧 `.env` 不再读取，也不会自动导入或删除。更新代码后重启 DSH，必要时刷新网页。
- **启停**：在插件页操作，停用撤回服务和工具并取消读取，不改数据库。避免与旧 Gateway 或含同名组件的其他包重复启用。
- **配置缺失／CONFIG**：检查组件的五项连接字段，特别是用户名和密码。
- **连接失败／HTTP 401、403**：检查数据库运行状态、DSH 服务端可访问的地址端口及账号。
- **SCHEMA**：核对图空间和图名，确认是已有软件工厂业务图。
- **数据集未配置**：核对数据库公共节点或版本资料；不必修改连接表单。
- **超时／结果过大**：缩小查询范围、减少分页数量或使用摘要。

已验证构建、类型、只读查询、宿主 Tool／Remote 调度、实时配置更新和独立安装包加载，数据库响应均为模拟。真实 DSH 网页表单、安装及实际数据库连接尚未验证。

## 源码与发布文件

- 普通用户安装 ZIP；维护者将 `artifacts/` 中的 ZIP、TGZ 上传至 GitHub **Releases**。
- `artifacts/release/software-factory-gateway/` 是本地安装目录，可能残留旧本地配置，不直接上传。
- 源码提交到 Git；凭据、依赖与构建产物不提交。

<details>
<summary>开发构建</summary>

当前需完整软件工厂总仓、共享 contracts 和已有 DSH 开发依赖；仅克隆此子仓库尚不能独立编译。在总仓根目录执行：

```powershell
node packages/gateway/scripts/build.mjs
node packages/gateway/scripts/check.mjs
node packages/gateway/scripts/pack.mjs
node --experimental-transform-types --test packages/gateway/tests/*.test.ts
```

</details>
