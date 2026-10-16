# 工作坊 · WorkSpace SwiftUI 原生工程

应用对外统一称为“工作坊”，软件内英文名称统一写作 **WorkSpace**。桌面名称、Mac 菜单、通知、系统提示、实时活动扩展和导出归档使用中文名称；工程名、Bundle ID、数据存储标识及已有归档格式继续兼容。

面向 **iPhone 和 Mac** 的共享 SwiftUI 实现，并附带同源只读网页版。原生工程直接打开 `GuangyiWorkSpace.xcodeproj`，无需安装 CocoaPods、XcodeGen 或第三方 Swift 包；网页源码由后端构建进单文件发布包，不依赖原 Sites 工程。

## 在 Xcode 中打开

1. 使用 Xcode 15.3 或更新版本，推荐当前稳定版本。
2. 双击 `GuangyiWorkSpace.xcodeproj`。
3. iPhone 选择 Scheme **GuangyiWorkSpace-iOS** 和一个 iPhone 模拟器，按 ⌘R。
4. Mac 选择 Scheme **GuangyiWorkSpace-Mac**，运行目标为 **My Mac**，按 ⌘R。
5. 真机运行时，在 Signing & Capabilities 中选择你自己的 Team；必要时修改 Bundle Identifier。工程没有绑定作者的签名身份。

最低系统：iOS 17、macOS 14。Mac 是独立 macOS 原生目标，不是 Catalyst。iOS 目标也允许在 iPad 上运行，但本次重点为 iPhone/Mac，未验证 iPad 布局。

项目包含三个共享 Scheme：iPhone 应用、Mac 应用和 WorkspaceCoreTests。`Package.swift` 用于独立运行业务测试，使用系统 Foundation/CryptoKit；应用应打开 `.xcodeproj`。

## 原生实现

当前原生分类统一为 **项目组、事项、截止事项**。原领域/项目/行动组归入项目组，原行动/提醒/里程碑归入事项；新建只使用这三个名称。事项可由用户手动标星为关键事项，支持列表滑动、上下文菜单、详情按钮和编辑开关，并可筛选关键事项。旧里程碑不会自动标星。旧记录的 ID、关联、原始类型编码和快照格式保持兼容；新记录使用统一的新建入口。

| 功能 | 原生 API / 实现 |
| --- | --- |
| iPhone 主导航 | TabView：首页、项目组、事项、截止事项；首页为默认入口，聚合简短摘要与醒目倒计时 |
| Mac 导航 | NavigationSplitView：首页、项目组、事项、截止事项；原生菜单、⌘N、⌘0/⌘1/⌘2/⌘3 与 ⌘R |
| 列表和编辑 | List、Form、NavigationStack、DatePicker、Picker、原生搜索、滑动操作和上下文菜单 |
| 本机持久化 | SwiftData；独立上下文保存成功后才更新界面；PDF 使用 externalStorage |
| 行动与行动组 | 跨类型统一排序（置顶、未完成、时间、最近编辑）、状态、领域、里程碑、关联、安排、截止、完成/重开与归档 |
| 截止事项 | 日期/时刻、时区、改期、完成、取消、倒计时、重复、例外实例和历史记录 |
| 周期重复 | 事项及截止事项；每天、每周、隔周、单周、双周、周一至周五、含调休工作日、每月；可选星期、间隔和结束日期 |
| 日历与时间线 | 原生图形日期选择、日程列表、Swift Charts 项目图表 |
| 回收站 | 删除范围预览、版本复核、项目级联恢复、30 天边界；知识笔记独立恢复期限 |
| 知识库 | 标题/正文/标签搜索、分类、置顶、Markdown 编辑与原生文本预览、版本恢复、PDFKit 附件阅读 |
| 系统通知 | UserNotifications；到期提醒、点击定位、完成与十分钟稍后提醒 |
| 实时活动 | 锁屏深色卡片；灵动岛紧凑、展开、最小态；有边界的系统倒计时与进度条 |
| 操作反馈 | 统一主次按钮；轻按触感、选择反馈、成功/错误反馈；触感开关与减弱动态效果适配 |
| 系统日历 | 用户主动授权后，EventKit 创建/更新相关事件 |
| 个人资料 | PhotosPicker、ImageIO 居中裁剪与去除原头像 EXIF、姓名、默认时区 |
| 文件交换 | 原生文件选择和导出；JSON 或密码加密的 .gwspace 归档 |
| 自建服务器 | URLSession、HTTPS、Keychain、快照版本检查、APNs 设备注册接口 |
| 只读网页版 | 同账号密码/通行密钥登录、行动与 DDL、按记录时区计算的秒级倒计时 |

界面使用简体中文、SF Symbols 和系统语义样式，遵循系统外观与辅助功能字号。辅助字号下，列表标题完整换行，状态与日期改为纵向排列；应用内、锁屏实时活动与灵动岛倒计时在 VoiceOver 中提供简洁语义，并在“减弱动态效果”开启时停用数字过渡。应用主体没有 WKWebView。

iPhone 各主入口的“设置”按钮直接打开统一设置页；顶部账号卡片进入同一页管理头像、姓名、登录与云同步。登录服务固定为工作坊官网，不提供地址输入框。知识库、日历、时间线、归档与回收站集中在设置的“工作空间”分区。

## 事项时间与周期重复

计划时间表示打算何时处理；截止日期是可选的最晚完成期限；系统提醒表示何时收到通知，不必同时填写三种时间。提醒区会显示依据和实际通知时间：默认参考截止，无截止时参考计划；仅日期截止以当天09:00为基准，再扣除提前量。自定义提醒是准确通知时刻，不会再次扣除提前量。通知仍要求开启本机提醒并取得系统权限。

新建或编辑未重复的事项时可开启“周期重复”，已有事项也可在详情菜单选择“设置重复”。单周/双周以可设置的第1周周一为基准，连续跨年计算；按教学周使用时自行选择学期第1周。每周选择间隔2即为隔周重复。当前首次事项保留，后续的计划、截止与自定义提醒会一起移动，并保留各自的当地时刻；单次编辑不改变模板。首页与默认列表按重复分组显示，避免将未来所有实例堆在首页；详情可查看后续实例，列表筛选可切换为全部显示。

“工作日（含调休）”采用中国大陆法定放假及补班日，区别于普通“周一至周五”。内置2025—2026年数据，依据[2025年国务院通知](https://www.forestry.gov.cn/c/www/szxx/594663.jhtml)与[2026年国务院通知](https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202511/t20251104_4258838.html)。未覆盖年份暂停生成且不跨过该年份推进缓存，需更新内置调休日历后继续；不自动推断学校另行安排的补课日。其他频率维持未来三年的滚动生成窗口。

每个实例可单独完成、改期或取消；停止后续重复会关闭未来未完成实例，保留过去和已完成实例。未来实例使用稳定标识，避免两台离线设备重复生成同一项；生成进度的变化不会作为用户编辑冲突，一端停止后另一端新增的未编辑未来实例也会关闭提醒。新规则增加了频率编码，使用账号同步时需同时更新 iPhone 与 Mac 客户端；旧的日/周/月规则及旧归档仍可读取。

## 本机数据与设备迁移

默认本机存储，未启用 CloudKit。iPhone 与 Mac 共用代码，但不会因为使用 SwiftUI 就自动同步数据。

在“设置 → 导出归档”选择保存位置，再在另一台设备的“设置 → 导入归档”读取和审阅。支持密码加密及明文 JSON；导入先校验，再按“保留本机版本 / 使用导入版本”合并，不删除本机独有记录。

加密格式 `GWNA1` 使用 PBKDF2-HMAC-SHA256（200,000 轮、随机 16 字节 salt）和 AES-256-GCM。密码不保存，遗失后无法恢复。归档包含记录、循环、历史、PDF 和个人资料，不包含 Keychain 登录凭据或系统通知授权。JSON 时间精度为毫秒。

单个 PDF 最大 10 MB，归档内容最多 128 MiB。网页的 GWOS1/GWOS2 加密备份采用不同格式，不能直接导入；本版未迁移原网站生产数据。Markdown 预览支持标题、代码块、引用和原生内联样式；保留全部原文，但未复制网页 KaTeX 数学排版、代码高亮和完整 GFM 表格渲染。

## 本地通知

在“设置 → 系统通知”允许通知，发送测试通知；原生本地通知不需要网站定时器或 APNs 服务器。

提醒必须设置具体时间并开启通知。带时刻的截止事项按时刻提醒；仅日期截止事项在当天 09:00 提醒，可选择提前量。“十分钟后提醒”不改动原截止日期。

应用保守安排最近 60 条待触发通知，每次进入前台重新补齐。**长时间不打开应用时，超出已安排队列的未来提醒不会自动补齐**。已经安排的通知可在应用关闭后由系统触发，但仍受系统权限、专注模式、网络/设备状态影响。重复记录滚动补齐未来三年，含调休工作日以已核实年份为上限。完成、关闭提醒、改期或稍后提醒后，旧通知横幅不能再修改当前记录，并会在重新安排时从通知中心清理。

## 自建服务器与 APNs

`Server/` 包含 Node.js 24 后端：SQLite 持久化、scrypt 密码哈希、作用域会话、版本条件快照读写、设备注册与每 30 秒后台派发。源码构建使用固定版本的 SimpleWebAuthn 与 esbuild，发布后的单文件运行时无需 npm install。服务端只在配置 Apple APNs 凭据后发送远程通知。

通过系统网页登录（通行密钥或账号密码）或 App 内账号密码登录后，客户端自动合并本机与云端内容并开启同步；同一记录冲突时保留双方并打开比较。此后客户端在前台修改后和定时自动同步，iOS 也会申请系统后台刷新；上传携带 If-Match，并以账号专属基线做三方合并。配置 APNs 后，服务器还会在 revision 更新时发送不含业务正文的静默提示，让已登记设备尽快拉取。系统决定后台执行时间；当前仍是完整快照协议，不是操作日志式增量同步，也没有多用户共享权限。详见 `API-CONTRACT.md` 和 `Server/README.md`。

生产 API 已在 `https://workspace.kdfz.com.cn` 使用独立 Node.js 24、systemd 服务、Nginx 配置和证书运行；专用 GitHub Actions 发布及受限部署密钥已经验收。旧 Node.js 22 服务和旅行项目均保留且未改动。真实 APNs 凭据、两个原生目标的签名描述文件及真机收件仍待单独验收。

`Server/web.mjs` 提供根路径的只读网页版：登录后只读取服务器快照，主入口只有“行动”和“DDL”，不会从浏览器提交完整快照。行动跨类型排序与原生端一致，已归档或删除的行动组不会泄露其子行动。DDL 依照记录时区处理日期型截止并按秒倒计时，精确到点即进入逾期状态；页面使用同源资源、严格 CSP，Bearer 会话只存于当前标签页的 `sessionStorage`。旧 Sites 项目在当前账号与仓库中均不可访问，因此这里是依据现有原生数据契约重建的实现，不声称还原旧站源码。

忘记原密码且没有现成通行密钥时，服务器本机管理员可以生成十分钟、一次性、只存哈希的登记链接。链接只允许为既有账号创建经过系统用户验证的新通行密钥，不会开放注册、重建账号、修改密码或替换工作空间；具体命令和边界见 `PASSKEYS.md`。

接入远程通知时：

1. 为两个 Target 分别选择签名 Team 并添加 Push Notifications 能力。
2. 在对应 Info.plist 将 RemotePushEnabled 改为 YES；iOS 静默推送还需向 UIBackgroundModes 添加 remote-notification。默认关闭，便于 Personal Team 本机测试。
3. iOS 和 Mac 的 APNs entitlement 不同；使用 Xcode 自动生成对应配置，不要混用示例。
4. 把 Apple Team ID、Key ID 和 .p8 私钥安全配置到服务器，绝不放入应用或版本库。
5. 在应用登录自建服务器，注册设备并验证远程收件。Debug 对应 sandbox，Release 对应 production；最终以签名配置一致为准。
6. 确认远程推送可用后，可关闭本机定时提醒，避免本地与远程各显示一次。

网页 VAPID 密钥不能代替原生 APNs 私钥。原生 APNs 需要支持该能力的 Apple 开发者签名配置；本地通知不需要远程推送能力。

## 验证

主要 iPhone 目标为用户的 **iPhone 17 Pro**。界面、灵动岛与实时活动验收优先使用该型号；Apple 本机模拟器配置为 1206×2622 像素、3×，即 402×874pt。已在独立的 iPhone 17 Pro 模拟器实际核对短计时紧凑态、两行长标题展开态、唤醒锁屏的小时级倒计时与右边缘对齐；原始截图为顶层 `LocalVerification/island-17pro-compact-short.jpg`、`island-17pro-expanded-long.jpg`、`island-17pro-lock-hours.jpg`，报告为 `island-17pro-validation.json`。当前已安装的模拟器系统为 iOS 27，不能据此推断用户实体机的系统版本；实体机尚未运行验收。

灵动岛布局按 [Apple Live Activities 规范](https://developer.apple.com/design/human-interface-guidelines/live-activities) 调整：紧凑态为左侧剩余时间进度环、右侧倒计时；展开态保持两者位置，在摄像头下方补充两行标题与截止时间；最小态继续显示动态进度环。计时使用隐藏的静态宽度样本约束系统计时文字，并明确设置文字靠右；避免固定大框在短计时右侧留下黑色空位。展开态横向边距 24pt、底部 20pt，锁屏留白 16pt，避免文字进入圆角裁切区。该处理遵循 [Apple 计时 Text 的宽度与对齐说明](https://developer.apple.com/documentation/swiftui/text/init(timerinterval:pausetime:countsdown:showshours:))。iOS 27 受限宽度隐藏宽计时，仅保留 22pt 进度环；旧 SDK/iOS 保留兼容布局。Widget 源码内提供四种状态的 Xcode 预览。本轮用与正式 Widget 逐字相同的临时模拟器副本实际核对了四分多钟的紧凑态、短/长标题展开态与锁屏对齐，原始截图保存在顶层 LocalVerification/island-correction-*.png。

当前本机已完成 SwiftPM 49 项、Apple XCTest 53 项、iOS 主应用与 Live Activity Widget 构建、macOS 构建和工程静态校验。首页恢复为默认入口，行动组与行动仍统一归入行动。iPhone 18 Pro 模拟器实际核对了两行长标题的灵动岛展开态、紧凑计时、锁屏卡片和完成后结束追踪；最大辅助字号下，详情长标题、倒计时与完成按钮可完整阅读。触感只做代码与编译验证，模拟器不能证明物理感受。

默认开发配置面向 Personal Team：原生通行密钥与 APNs 已暂停；系统网页登录支持网页通行密钥和账号密码，也保留 App 内邮箱密码登录。本地通知、触感、灵动岛、实时活动、前台同步和系统后台刷新保留。`Config/iOS.entitlements` 不申请 Associated Domains 或推送权限，两个 Info.plist 的 NativePasskeysEnabled 与 RemotePushEnabled 均为 NO。网页登录使用固定自定义 scheme 回调、90 秒一次性授权码与 S256 PKCE，不需要关联域名。已移除调试参数绕过 APNs 开关的路径。

日后具备支持能力的签名 Team 时，原生通行密钥可改用 `Config/iOS-Passkeys.entitlements`（Mac 对应 `Config/Mac-Passkeys.entitlements`），并将对应 Info.plist 的 NativePasskeysEnabled 改为 YES；仍需正确描述文件和 Associated Domains 配置。当前可使用系统网页登录，无需开启这些权限。完整验证边界见 `VALIDATION.md`。

在 Mac 上运行：

```sh
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme GuangyiWorkSpace-Mac -configuration Debug -destination 'platform=macOS' build
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme WorkspaceCoreTests -destination 'platform=macOS' test
# 按你安装的模拟器名称替换下面的示例目标
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme GuangyiWorkSpace-iOS -destination 'platform=iOS Simulator,name=Guangyi iPhone 17 Pro' build
swift test
npm test
# macOS：真实原生 HTTP 传输 + 临时本机 Node API，同账号双会话同步验收
python3 Scripts/Acceptance/run-native-server-sync.py
```

工程当前提供 49 项 SwiftPM 业务测试和 53 项 Apple XCTest；本机真实 API 验收包含11项检查，数量以后续新增测试为准。

`Scripts/generate_project.py` 用于重生成已附带的工程；通常不需要运行，且会覆盖工程配置。图标已附带，生成脚本仅供开发维护。
