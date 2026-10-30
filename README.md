# 软件工厂 HugeGraph 只读网关

运行在 DeepSeek Harness（DSH）中的后端插件，为软件工厂提供统一的 HugeGraph 查询能力，供网页、其他插件和 AI 工具调用。

**普通用户请下载 Releases 中的预编译安装包，按下面的快速启动步骤安装。源码下载 ZIP 不等于插件安装包。** 本插件依附 DSH 运行，没有独立网站、额外网页端口或单独的启动命令。

## 功能

- **能力与 Agent 查询**：读取能力分类树、逻辑 Agent、节点详情及相关关系，支持按分类范围和关键词查找。
- **版本与候选查询**：读取某个 Agent 的版本，按能力、关键词、登记状态、模型依赖和开发人员筛选候选版本，支持分页。
- **独立版本描述**：分别返回逻辑 Agent 的总体能力和当前版本的具体能力；版本描述未填写时不会使用逻辑描述代替。
- **字段定义与图快照**：读取 FieldGroup 元数据及指定范围的节点、关系和统计。当前数据库基线为八大类19项字段。
- **连接健康检查**：检查数据库连接、所需结构及接口版本，返回可用于排查的诊断信息。

三个入口共用同一套读取逻辑：后端服务 `hugegraphRead`、DSH 网页 Remote 和工具 `hugegraph_read`。Gateway 只提供事实和筛选结果，不负责数据库写入、候选排名、任务编排或算法执行。

## 环境与配套插件

当前插件版本为 **0.1.1**，读取接口为 **API 1.0**。开发和兼容目标如下，其他版本需另外核对。

| 项目 | 要求 |
| --- | --- |
| DSH 宿主 | `0.2.1-alpha.2`，原生网页能够正常登录并管理插件 |
| Node.js | 运行 DSH 的环境为 `24` 或以上 |
| Cordis | peer 版本为 `4.0.5-alpha.1`，由兼容 DSH 环境提供 |
| HugeGraph | `1.7.0`，能够从 DSH 服务端电脑连接 |
| 业务数据 | 已有软件工厂的能力树、Agent、AgentVersion、FieldGroup 及对应关系 |

数据库可以部署在本机，也可以使用已有远程服务。**只安装 Gateway 不会创建数据库、导入业务数据或迁移 Schema。** 地址、端口、图空间、图名和账号密码需要按已有数据库填写。

Gateway 本身不依赖 Manage 或 WebUI。需要可视化概览时安装软件工厂 WebUI；需要注册、编辑和人工保存时安装 Manage。模型和真实业务插件由 DSH 及对应业务模块配置，Gateway 不单独配置模型。

## 新电脑快速启动：使用预编译包

### 1. 准备宿主和数据库

1. 安装并启动兼容版本的 DSH，确认网页可以正常登录，且有“插件”管理入口。
2. 准备已有的软件工厂 HugeGraph 数据库，确认服务运行，取得实际连接地址、图空间、图名及账号密码。
3. 如果浏览器与 DSH 运行在不同电脑，以下安装文件和 `.env` 都应放在 **DSH 服务端电脑**上。

本 README 从 DSH 和业务数据库已准备好开始说明。宿主及数据库服务的安装、启动和数据恢复，按对应项目的说明操作。

### 2. 下载并解压 Gateway

从项目的 **Releases／发布** 下载 `software-factory-gateway-0.1.1.zip`，解压到一个长期保留的目录，例如：

```text
D:\DSH-Plugins\software-factory-gateway\
├── package.json
├── cordis.patch.yml
├── .env.example
├── README.md
├── docs\
├── lib\
├── locale\
└── icon.svg
```

以**包含 `package.json` 的目录**为准；解压后如果多了一层文件夹，继续进入内层。

使用预编译包不需要编译源码、手动运行 `npm install` 或启动额外进程。DSH 安装器仍可能联网解析宿主依赖，因此不承诺完全离线安装。尚未发布 Release 时，请联系维护者获取预编译 ZIP。

### 3. 填写数据库配置

在解压后的插件目录中，将 `.env.example` 复制为 `.env`，与 `package.json` 放在同一层。用记事本填写：

```dotenv
HUGEGRAPH_BASE_URL=http://127.0.0.1:18080
HUGEGRAPH_GRAPHSPACE=DEFAULT
HUGEGRAPH_GRAPH=hugegraph
HUGEGRAPH_USERNAME=
HUGEGRAPH_PASSWORD=
```

| 配置项 | 填写说明 |
| --- | --- |
| `HUGEGRAPH_BASE_URL` | 数据库地址和端口。示例连接本机 `18080`；远程数据库使用 HTTPS，不在地址后添加 REST 路径 |
| `HUGEGRAPH_GRAPHSPACE` | 已有图空间，当前软件工厂示例为 `DEFAULT` |
| `HUGEGRAPH_GRAPH` | 已有业务图，当前示例为 `hugegraph` |
| `HUGEGRAPH_USERNAME` | 数据库用户名，不能留空 |
| `HUGEGRAPH_PASSWORD` | 数据库密码，不能留空；含 `#` 时用单引号包住整个值 |

注意文件名是 `.env`，不要保存成 `.env.txt`。`127.0.0.1` 指向运行 DSH 的电脑；数据库在其他机器上时，要填写那台数据库服务的实际地址。

配置只由后端读取。账号密码在本地填写，不放进聊天、前端设置或发布包。本插件不额外监听端口，数据库端口与 DSH 网页端口是两回事。

### 4. 在 DSH 网页安装

1. 打开“插件 → 添加插件 → 安装第三方插件”。
2. 安装来源填写上述插件目录的绝对路径，例如 `D:\DSH-Plugins\software-factory-gateway`，不要填写 ZIP 文件路径或 `lib` 子目录。
3. 安装完成后启用对应组合包及“软件工厂 HugeGraph 只读网关”，检查插件条目 `sf-hugegraph-read` 是否正常加载。
4. 如需可视化页面，再按 WebUI 的说明安装前端；只安装 Gateway 不会新增概览侧栏页面。

安装目录必须长期保留，不要在安装后删除、移动或改名。不要同时启用旧 Gateway，或已经包含 Gateway 的聚合 Bundle，以免同名服务和工具重复注册。

### 5. 验证可用

在 DSH 中调用 `hugegraph_read` 工具，检查连接：

```json
{"action":"health"}
```

结果中的 `ok: true` 且 `data.ready: true`，表示本次数据库连接和所需结构检查通过；同时可查看连接状态、结构状态、插件版本和接口版本。

再查询已登记为启用的候选版本：

```json
{"action":"read","query":{"kind":"candidates","status":"enabled","limit":20,"detail":"full"}}
```

能够返回实际记录，表示该次读取可用。没有匹配项也可能是正常结果，应核对数据库内容及筛选条件。

**安装完成不等于数据库连接已通过；`enabled` 仅表示登记状态，不表示业务工具已安装、模型可用或执行成功。** 验证 Gateway 无需运行真实算法。

## 接口与调用方式

| 入口 | 名称 | 使用者 |
| --- | --- | --- |
| 后端服务 | `hugegraphRead` | 其他 DSH 插件的后端 |
| 网页 Remote | `hugegraphRead/health`、`hugegraphRead/snapshot`、`hugegraphRead/read` | DSH 网页插件 |
| 工具 | `hugegraph_read` | DSH 的工具调用链 |

提供 `health()`、`snapshot(options)` 和 `read(query)`；查询包括分类树、节点、Agent、版本、候选版本和字段定义。默认列表每页50项，单页最多100项；需要描述及完整材料时使用 `detail: "full"`。

完整参数、返回结构、分页、TypeScript、Remote 和 Tool 示例见 [接口文档](docs/gateway-api.md)。逻辑 `agent_id`、业务版本号和图顶点 ID 是不同标识，接入时按接口要求使用。

## 更新与停用

- **修改配置**：修改本地 `.env` 后，在 DSH“插件”页停用再启用 Gateway，重新读取连接信息。
- **更新版本**：先备份 `.env`，将配置复制到新版目录，再更新插件；替换代码后重启 DSH，按需用 `Ctrl+F5` 刷新网页。
- **停用／启用**：在 DSH“插件”页操作。停用后撤回查询入口并取消尚未完成的读取，不删除数据库或本地配置。
- **保留目录**：使用本地目录安装后，安装路径需要持续有效。发布包仅附空白配置示例，不带真实账号密码。

## 遇到问题

- **提示缺少配置或 `CONFIG`**：检查 `.env` 是否在 `package.json` 旁边、是否误存为 `.env.txt`、五项配置是否填全；保存后重新启用插件。
- **数据库连接失败或 `DATABASE`**：确认数据库已启动，检查服务端实际可访问的地址和端口；远程连接需使用 HTTPS。
- **返回 HTTP 401／403**：核对本地填写的数据库账号和密码，以及该账号的数据库访问范围。
- **结构不兼容或 `SCHEMA`**：确认图空间和图名正确，连接的是已有软件工厂业务图；新建空图不能直接用于本插件。
- **工具未出现或提示名称冲突**：检查 Gateway 是否启用，避免与旧 Gateway 或聚合 Bundle 重复启用；必要时重启 DSH。
- **查询超时或结果过大**：缩小分类范围、减少单页数量或使用摘要；提示数据已变化时从第一页重新查询。

当前已完成自动化测试、构建和安装包检查。真实 DSH 网页安装及实际数据库连接仍需在部署环境验证。

## 源码与发布文件

- **安装包**：位于 `artifacts/`，普通用户使用 ZIP，发布时上传到远程仓库的 **Releases**。
- **本地安装目录**：`artifacts/release/software-factory-gateway/`，可能含本地配置，不直接上传。
- **源码**：提交到 Git；真实 `.env`、依赖和构建产物不提交。

<details>
<summary>开发构建</summary>

需使用完整软件工厂总仓及已有 DSH 开发依赖，单独克隆此子仓库暂不能编译。在总仓根目录执行：

```powershell
node packages/gateway/scripts/build.mjs
node packages/gateway/scripts/check.mjs
node packages/gateway/scripts/pack.mjs
node --experimental-transform-types --test packages/gateway/tests/*.test.ts
```

</details>
