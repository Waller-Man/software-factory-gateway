# Gateway read API 1.0

状态：2026-10-29，用户已批准方案；实现包packages/gateway，接口类型唯一来源packages/contracts/src/gateway.ts。此文件只定义Gateway，不替其他模块确定执行/写入协议。新增最小根构建配置用于本模块，其他模块接入前由总控协调。

## 入口与依赖

- 包：@software-factory/gateway 0.1.1，目标DSH 0.2.1-alpha.2；查询API保持1.0。
- 后端服务：hugegraphRead；其他插件inject=['hugegraphRead']、peerDependency @software-factory/gateway ^0.1.1，并导入其/types。
- Remote：hugegraphRead/health、hugegraphRead/read、hugegraphRead/snapshot；使用DSH认证Connection、生成的严格Typert描述符，取消信号由宿主注入。导出/remote；本包提供无页面Client桥，消费者不重复mount。
- Tool：hugegraph_read；严格action联合：{action:'health'}、{action:'snapshot',options:{}}、{action:'read',query:{kind:...}}。信号来自exec.signal，不接受审批/写入/连接参数。
- 服务：health(signal?)、snapshot(options,signal?)、read(query,signal?)；apiVersion='1.0'。不兼容旧服务snapshot(signal)。

三个入口复用Reader和私有ReadClient。底层只有固定GET Schema、四类顶点、三类边源邻接；没有通用HTTP、Gremlin、CUD或写入授权通道。Remote还复核原始wire值，避免生成codec剥离未知字段后绕过参数拒绝。

## 参数

| 方法/kind | 必填 | 可选/默认 |
|---|---|---|
| health | 无 | 信号，不属于JSON参数 |
| snapshot | options对象 | rootCapabilityId；includeVersions=false；maxDepth=8；maxNodes=500；maxEdges=1500；detail=summary |
| capability_tree | kind | rootCapabilityId；maxDepth=8；maxNodes=500；maxEdges=1500；detail=summary |
| node | vertexId | limit/offset/expectedFingerprint |
| agents | kind | agentId/capabilityId/keyword；includeDescendants=true；detail=summary；分页 |
| versions | agentId | version原文等值；detail=summary；分页 |
| candidates | kind | capabilityId/keyword/status/developer/model{name,vendor?}；includeDescendants=true；detail=summary；分页 |
| field_groups | kind | groupId；分页；完整原始元数据与JSON状态 |

全部kind必填；未知字段拒绝。非空字符串通常上限512字符，图ID4096，拒绝控制字符；总查询16KiB。树根默认唯一name=软件工厂，缺失/歧义报错。无能力筛选的列表在当前标签数据中查询。

agentId=Agent.agent_id；vertexId是数据库实际顶点ID；version是业务版本字符串。插件包版本与接口版本也独立。禁止用业务ID伪造原生ID或从版本字符串推断调用参数。

### 通用参数的类型、必填项及取值

| 参数 | 类型 | 默认/限制与适用范围 |
|---|---|---|
| kind | 六种白名单字符串 | read必填；不是Tool名字 |
| rootCapabilityId | string | snapshot/capability_tree可选，使用实际Capability顶点ID；省略查唯一“软件工厂” |
| includeVersions | boolean | 仅snapshot，默认false |
| maxDepth | integer | 图接口默认8，范围0..16，只计HAS_CHILD层级 |
| maxNodes | integer | 图接口默认500，范围1..1000 |
| maxEdges | integer | 图接口默认1500，范围0..3000 |
| detail | summary或full | 图接口/agents/versions/candidates默认summary；node和field_groups固定full |
| vertexId | string | node必填，实际数据库顶点ID |
| agentId | string | versions必填、agents可选，Agent.agent_id原文 |
| version | string | 仅versions可选，按业务版本原文等值，不推断最新版本 |
| capabilityId | string | agents/candidates可选，实际Capability顶点ID；省略不限制分类 |
| includeDescendants | boolean | agents/candidates默认true；配合capabilityId，false仅直接挂载 |
| keyword | string | agents/candidates可选；非空白字面子串 |
| status | string | candidates可选，登记状态原文等值 |
| developer | string | candidates可选，完整姓名，按顿号切分后匹配 |
| model | object | candidates可选，name必填string、vendor可选string，拒绝其他键 |
| groupId | string | field_groups可选，FieldGroup.group_id |
| limit | integer | 列表/node关系默认50，范围1..100 |
| offset | integer | 列表/node关系默认0，范围0..2000 |
| expectedFingerprint | string | 列表/node关系可选，64位小写十六进制指纹 |
| signal | AbortSignal | 后端可选；Remote由宿主载体处理，Tool由exec.signal传入；不是JSON查询字段 |

未指定过滤条件的列表不默认为enabled或排除able；接口只提供事实，不替调用者判断可执行性。字段名、枚举或参数类型错误返回INVALID_INPUT（Remote/Tool可能先由宿主校验拒绝）。

分类默认包含自身与后代，false仅直接挂载Agent；后代筛选最多16层，超限失败。关键词trim、大小写不敏感、字面子串，不分词/正则；agents查agent_id/name/description，candidates加AgentVersion.description/version/developer/dsh_ref/model vendor/name/object_categories。筛选条件AND；status原文等值（包括able，未来非空TEXT不硬编码拒绝）；developer按顿号切分完整姓名等值；model name必填、vendor可选，trim并忽略大小写等值，不推断实际DSH路由。缺省字段不补造，synthetic信息不当作真实执行事实。

## 数据与结果

GatewayResult<T> = {ok:true,data,meta} | {ok:false,error:{code,message,field?}}。

meta：apiVersion、observedAt（ISO UTC）、consistency='best-effort'、fingerprint、complete、truncated、reasons、warnings、unknownCount。Remote另包宿主RemoteResult，需检查传输与业务两层ok。Tool内容和值遵循宿主输出格式，内层ok才表示业务查询是否成功。

- GraphSnapshot：rootCapabilityId/nodes/edges/stats；stats.scope='returned'，按返回节点和边统计，不宣称数据库总数。snapshot含Agent和可选版本；capability_tree仅分类。
- NodeData：kind/node完整详情/relations/本页neighbors摘要/page。
- 列表：kind/items/page；候选每行{agent,version}，不混入关系行、不评分。
- NodeView：vertexId/label/detail/properties。summary只含常用字段且不宣称其他字段缺省。full另有missingFields/jsonFields，properties保留当前白名单原值。
- JSON字段状态：missing；parsed+value（合法JSON null也属parsed）；invalid+error。原文不丢弃；解析错误不当空数组。input/output不编译，Capability历史策略不暴露、不继承，模型等只从版本JSON读取。
- JSON结构异常影响筛选时complete=false、unknownCount与warnings，未知项不作为匹配；totalRelation=lower_bound，不谎报完整空结果。单纯JSON详情解析失败属于数据诊断，不自动表示扫描不完整。
- 独立描述：完整详情中Agent.properties.description为逻辑总体能力，AgentVersion.properties.description为当前版本具体能力。候选保持agent/version分开；不继承、不自动复制、不互相回写。版本描述缺省时属性省略、missingFields包含description，界面显示“未填写”。summary继续省略两种描述，选择版本需读取full详情。
- FieldGroup按数据库实际读取；八组为分组基线，缺组或fields_json非数组时警告；字段总数不设固定门槛，不补写定义、不把分类混入能力树。

### 可导入的完整类型结构

下面为类型结构说明，不代表真实数据库运行记录。全部DTO从`@software-factory/gateway/types`导入，唯一源码仍为packages/contracts/src/gateway.ts。

```ts
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type GatewayResult<T> =
  | { ok: true; data: T; meta: ResultMeta }
  | { ok: false; error: { code: string; message: string; field?: string } };
interface ResultMeta {
  apiVersion: '1.0'; observedAt: string; consistency: 'best-effort';
  fingerprint: string; complete: boolean; truncated: boolean;
  reasons: string[];
  warnings: { code: string; message: string; vertexId?: string; field?: string }[];
  unknownCount: number;
}
interface Health {
  apiVersion: '1.0'; gatewayVersion: string; ready: boolean;
  connection: 'reachable' | 'unreachable' | 'not_checked';
  schema: 'compatible' | 'incompatible' | 'unknown';
  diagnostic?: { code: string; message: string; field?: string };
}
type JsonField = { state: 'missing' }
  | { state: 'parsed'; value: Json }
  | { state: 'invalid'; error: string };
interface NodeView {
  vertexId: string;
  label: 'Capability' | 'Agent' | 'AgentVersion' | 'FieldGroup';
  detail: 'summary' | 'full'; properties: Record<string, Json>;
  missingFields?: string[]; jsonFields?: Record<string, JsonField>;
}
interface ReadEdge {
  id: string; label: 'HAS_CHILD' | 'HAS_AGENT' | 'HAS_VERSION';
  outV: string; inV: string;
  outVLabel: 'Capability' | 'Agent' | 'AgentVersion' | 'FieldGroup';
  inVLabel: 'Capability' | 'Agent' | 'AgentVersion' | 'FieldGroup';
}
interface Page {
  offset: number; limit: number; total: number;
  totalRelation: 'exact' | 'lower_bound';
  hasMore: boolean; nextOffset: number | null;
}
interface GraphSnapshot {
  rootCapabilityId: string; nodes: NodeView[]; edges: ReadEdge[];
  stats: { nodes: number; edges: number; byLabel: Record<string, number>; scope: 'returned' };
}
type ReadData = GraphSnapshot
  | { kind: 'node'; node: NodeView; relations: ReadEdge[]; neighbors: NodeView[]; page: Page }
  | { kind: 'agents' | 'versions' | 'field_groups'; items: NodeView[]; page: Page }
  | { kind: 'candidates'; items: { agent: NodeView; version: NodeView }[]; page: Page };
```

summary属性范围：Capability只含name；Agent含agent_id/name；AgentVersion含version/status/developer/invoke_kind/dsh_ref；FieldGroup元数据查询固定full。full读取白名单全部已有属性，未存在的字段在missingFields列出，未加载的摘要字段不列为缺省。JSON解析只影响jsonFields，不覆盖原始properties中的TEXT。

health外层ok=true也可能ready=false，表示健康诊断已完成而数据库不可用；调用方应继续判断ready及diagnostic。取消、超时或输出限制可能直接返回ok=false。Remote再包宿主RemoteResult，需先检查宿主ok后再检查value.ok；Tool遵循宿主内容/value封装。

分页：limit=50（1..100）、offset=0（0..2000）；page={offset,limit,total,totalRelation,hasMore,nextOffset}。正常分页hasMore不等于truncated。total为本次完整有界扫描内匹配数，若筛选未知为已知匹配下界。hasMore仅描述已知匹配列表。Agent按agent_id、版本按version、候选按agent_id/version、分类元数据按display_order/group_id、关系按边ID，均以顶点ID兜底，字符串按代码单元顺序；不按语义版本或质量排名。

node合并一跳双向边、按边ID去重排序后统一分页；neighbors只含本页另一端。树和snapshot不分页，广度优先，深度仅计算HAS_CHILD；输出节点/边限制命中时complete=false/truncated=true并列reasons。边保证两端均在返回节点中。

指纹覆盖规范化对象键顺序、按ID排序的扫描数据与查询条件，不含offset/limit/expectedFingerprint。后续页可携带expectedFingerprint，不符报DATA_CHANGED。原始数据在多次读取间可变；扫描不是数据库事务快照，禁止据此声称多页强一致。

## 限制、错误与配置

默认扫描2000顶点/5000边/256请求，数据库页100；最大树深16。输出默认500节点/1500边，硬上限1000/3000。单个数据库响应2MiB、累计8MiB、公开结果1MiB。普通总超时30秒/单HTTP10秒，health总5秒；并发4，无排队，满额BUSY；无自动重试。扫描超限或中断不返回正常部分筛选结果；公开响应超字节也失败，不裁坏JSON。

错误code采用INVALID_INPUT/CONFIG/NOT_FOUND/SCHEMA/DATABASE/LIMIT/BUSY/TIMEOUT/CANCELLED/DATA_CHANGED。禁止回显HTTP错误正文、凭据、Authorization和私密路径。停用撤销入口并中止请求，升级不改数据库。

0.1.1配置：数据库连接五项统一由插件目录.env读取（HUGEGRAPH_BASE_URL、HUGEGRAPH_GRAPHSPACE、HUGEGRAPH_GRAPH、HUGEGRAPH_USERNAME、HUGEGRAPH_PASSWORD）。普通DSH Config仅含envFile（默认.env，相对实际安装目录）、timeoutMs/requestTimeoutMs/maxConcurrent；不再使用旧baseUrl/graphSpace/graph/credentialsFile覆盖项，也不回退到系统环境或旧JSON凭据。真实.env仅由用户本地填写，Git和发布包均排除；包内只含空白账号密码的.env.example。没有模型依赖或模型选择设置。

.env支持单行值、注释、单/双引号，不执行变量/命令；文件缺失、不可读取、超过16 KiB、编码异常、空值、重复/未知键返回脱敏CONFIG。只在后端读取，不检查文件或父目录的ACL、所有者及权限模式，不调用权限检查或修复脚本，也不改变实际文件权限。重新启用时重读，升级由用户备份/保留.env，不自动迁移。

发布ZIP预置编译产物，使用者无需编译或手工npm install，仍需兼容DSH，依赖解析由宿主插件管理器处理，未承诺完全离线。独立包不依赖重构仓库node_modules或contracts源码。具体配置、启动和安装示例见packages/gateway/README.md。

## 验证边界

已实施核心模拟与隔离宿主服务测试，覆盖真实Tool链/严格Remote调度，不使用实际profile。网页安装、真实数据库及认证端到端需另行验证。配置、依赖和共享类型变动详见docs/coordination/gateway.md，不自动通知其他会话。

2026-10-30数据库已追加可选AgentVersion.description（TEXT/SINGLE，nullable），复用description PropertyKey。当前八类19项，其中functionality.version_description按storage.vertex_label=AgentVersion、property=description绑定，display_order=15；原agent_capability保留。API版本仍为1.0，无Schema迁移或数据库写入。FieldGroup数量偏差只诊断，不作为读取字段数量上限。
编排消费者应读取候选full详情，分别使用agent逻辑背景与version独立描述；版本缺省不得以逻辑描述替代。仓库尚无orchestration实现，本次不新增该模块。
