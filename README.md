# 广益 WorkSpace · SwiftUI 原生工程

面向 **iPhone 和 Mac** 的共享 SwiftUI 实现，并附带同源只读网页版。原生工程直接打开 `GuangyiWorkSpace.xcodeproj`，无需安装 CocoaPods、XcodeGen 或第三方 Swift 包；网页源码由后端构建进单文件发布包，不依赖原 Sites 工程。

## 在 Xcode 中打开

1. 使用 Xcode 15.3 或更新版本，推荐当前稳定版本。
2. 双击 `GuangyiWorkSpace.xcodeproj`。
3. iPhone 选择 Scheme **GuangyiWorkSpace-iOS** 和一个 iPhone 模拟器，按 ⌘R。
4. Mac 选择 Scheme **GuangyiWorkSpace-Mac**，运行目标为 **My Mac**，按 ⌘R。
5. 真机运行时，在 Signing & Capabilities 中选择你自己的 Team；必要时修改 Bundle Identifier。工程没有绑定作者的签名身份。

最低系统：iOS 17、macOS 14。Mac 是独立 macOS 原生目标，不是 Catalyst。iOS 目标也允许在 iPad 上运行，但本次重点为 iPhone/Mac，未验证 iPad 布局。

项目包含三个共享 Scheme：iPhone 应用、Mac 应用和 WorkspaceCoreTests。`Package.swift` 仅用于独立运行纯 Foundation 业务测试，应用应打开 `.xcodeproj`。

## 原生实现

| 功能 | 原生 API / 实现 |
| --- | --- |
| iPhone 主导航 | TabView：行动、DDL |
| Mac 导航 | NavigationSplitView：行动、DDL；原生菜单、⌘N、⌘1/⌘2 与 ⌘R |
| 列表和编辑 | List、Form、NavigationStack、DatePicker、Picker、原生搜索、滑动操作和上下文菜单 |
| 本机持久化 | SwiftData；独立上下文保存成功后才更新界面；PDF 使用 externalStorage |
| 行动与行动组 | 状态、类型、领域、里程碑、关联、安排、截止、完成/重开与归档 |
| 截止事项 | 日期/时刻、时区、改期、完成、取消、倒计时、日/周/月循环、例外实例、停止后续循环和历史记录 |
| 日历与时间线 | 原生图形日期选择、日程列表、Swift Charts 项目图表 |
| 回收站 | 删除范围预览、版本复核、项目级联恢复、30 天边界；知识笔记独立恢复期限 |
| 知识库 | 标题/正文/标签搜索、分类、置顶、Markdown 编辑与原生文本预览、版本恢复、PDFKit 附件阅读 |
| 系统通知 | UserNotifications；到期提醒、点击定位、完成与十分钟稍后提醒 |
| 系统日历 | 用户主动授权后，EventKit 创建/更新相关事件 |
| 个人资料 | PhotosPicker、ImageIO 居中裁剪与去除原头像 EXIF、姓名、默认时区 |
| 文件交换 | 原生文件选择和导出；JSON 或密码加密的 .gwspace 归档 |
| 自建服务器 | URLSession、HTTPS、Keychain、快照版本检查、APNs 设备注册接口 |
| 只读网页版 | 同账号密码/通行密钥登录、行动与 DDL、按记录时区计算的秒级倒计时 |

界面使用简体中文、SF Symbols 和系统语义样式，遵循系统外观与辅助功能字号。应用主体没有 WKWebView。

## 本机数据与设备迁移

默认本机存储，未启用 CloudKit。iPhone 与 Mac 共用代码，但不会因为使用 SwiftUI 就自动同步数据。

在“设置 → 导出归档”选择保存位置，再在另一台设备的“设置 → 导入归档”读取和审阅。支持密码加密及明文 JSON；导入先校验，再按“保留本机版本 / 使用导入版本”合并，不删除本机独有记录。

加密格式 `GWNA1` 使用 PBKDF2-HMAC-SHA256（200,000 轮、随机 16 字节 salt）和 AES-256-GCM。密码不保存，遗失后无法恢复。归档包含记录、循环、历史、PDF 和个人资料，不包含 Keychain 登录凭据或系统通知授权。JSON 时间精度为毫秒。

单个 PDF 最大 10 MB，归档内容最多 128 MiB。网页的 GWOS1/GWOS2 加密备份采用不同格式，不能直接导入；本版未迁移原网站生产数据。Markdown 预览支持标题、代码块、引用和原生内联样式；保留全部原文，但未复制网页 KaTeX 数学排版、代码高亮和完整 GFM 表格渲染。

## 本地通知

在“设置 → 系统通知”允许通知，发送测试通知；原生本地通知不需要网站定时器或 APNs 服务器。

提醒必须设置具体时间并开启通知。带时刻的截止事项按时刻提醒；仅日期截止事项在当天 09:00 提醒，可选择提前量。“十分钟后提醒”不改动原截止日期。

应用保守安排最近 60 条待触发通知，每次进入前台重新补齐。**长时间不打开应用时，超出已安排队列的未来提醒不会自动补齐**。已经安排的通知可在应用关闭后由系统触发，但仍受系统权限、专注模式、网络/设备状态影响。循环记录预生成三年；客户端重新进入前台时滚动补齐。

## 自建服务器与 APNs

`Server/` 包含 Node.js 24 后端：SQLite 持久化、scrypt 密码哈希、作用域会话、版本条件快照读写、设备注册与每 30 秒后台派发。源码构建使用固定版本的 SimpleWebAuthn 与 esbuild，发布后的单文件运行时无需 npm install。服务端只在配置 Apple APNs 凭据后发送远程通知。

首次连接账号时会明确确认本机资料与服务器资料的合并。此后客户端在前台修改后和定时自动同步，iOS 也会申请系统后台刷新；上传携带 If-Match，并以账号专属基线做三方合并，同一记录的并发修改会暂停并要求审阅。配置 APNs 后，服务器还会在 revision 更新时发送不含业务正文的静默提示，让已登记设备尽快拉取。系统决定后台执行时间；当前仍是完整快照协议，不是操作日志式增量同步，也没有多用户共享权限。详见 `API-CONTRACT.md` 和 `Server/README.md`。

生产 API 已在 `https://workspace.kdfz.com.cn` 使用独立 Node.js 24、systemd 服务、Nginx 配置和证书运行；专用 GitHub Actions 发布及受限部署密钥已经验收。旧 Node.js 22 服务和旅行项目均保留且未改动。真实 APNs 凭据、两个原生目标的签名描述文件及真机收件仍待单独验收。

`Server/web.mjs` 提供根路径的只读网页版：登录后只读取服务器快照，主入口只有“行动”和“DDL”，不会从浏览器提交完整快照。DDL 依照记录时区处理日期型截止并按秒倒计时；页面使用同源资源、严格 CSP，Bearer 会话只存于当前标签页的 `sessionStorage`。旧 Sites 项目在当前账号与仓库中均不可访问，因此这里是依据现有原生数据契约重建的实现，不声称还原旧站源码。

接入远程通知时：

1. 为两个 Target 分别选择签名 Team 并添加 Push Notifications 能力。
2. 在对应 Info.plist 将 RemotePushEnabled 改为 YES。默认 NO，便于仅使用本地通知时运行。
3. iOS 和 Mac 的 APNs entitlement 不同；使用 Xcode 自动生成对应配置，不要混用示例。
4. 把 Apple Team ID、Key ID 和 .p8 私钥安全配置到服务器，绝不放入应用或版本库。
5. 在应用登录自建服务器，注册设备并验证远程收件。Debug 对应 sandbox，Release 对应 production；最终以签名配置一致为准。
6. 确认远程推送可用后，可关闭本机定时提醒，避免本地与远程各显示一次。

网页 VAPID 密钥不能代替原生 APNs 私钥。原生 APNs 需要支持该能力的 Apple 开发者签名配置；本地通知不需要远程推送能力。

## 验证

当前本机已完成 SwiftPM 27 项、Apple XCTest 30 项、iOS 主应用与 Live Activity Widget 构建、macOS 构建和工程静态校验。网页版新增后，Node 24 的 11 项测试全部通过，并在真实浏览器检查了桌面与 390 px 窄屏、密码登录、行动/DDL 切换、秒级倒计时、逾期样式和安全退出。真实通行密钥创建、已签名真机同步、APNs 收件与物理触感仍需用户设备验收。完整边界见 `VALIDATION.md`。

在 Mac 上运行：

```sh
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme GuangyiWorkSpace-Mac -configuration Debug -destination 'platform=macOS' build
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme WorkspaceCoreTests -destination 'platform=macOS' test
# 按你安装的模拟器名称替换下面的示例目标
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme GuangyiWorkSpace-iOS -destination 'platform=iOS Simulator,name=iPhone 16' build
swift test
npm test
```

工程当前提供 27 项 SwiftPM 业务测试和 30 项 Apple XCTest；数量以后续新增测试为准。

`Scripts/generate_project.py` 用于重生成已附带的工程；通常不需要运行，且会覆盖工程配置。图标已附带，生成脚本仅供开发维护。
