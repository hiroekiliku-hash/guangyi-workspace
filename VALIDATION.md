# 验证与交付边界

最近更新：2026-10-15，北京时间。本文件记录当前分支可复核的结果；早期 Linux 静态检查已由 Mac、Xcode、模拟器和自动化测试取代。

## 已验证

- Node 24 后端 13 项测试全部通过：网页时区/夏令时与截止临界点倒计时、跨类型排序、父行动组可见性、严格安全响应头和 API 鉴权，以及密码会话、快照冲突、数据回滚、设备约束、静默同步提示、提醒派发、失效设备清理、退出和真实 P-256 WebAuthn 验证。一次性通行密钥恢复还覆盖每账号唯一活动令牌、签发原子回滚、旧链接废止、错误/过期令牌、真实签名、成功后单次消费、直接数据库运维助手及只存令牌哈希。测试运行内存或临时 SQLite 和本机随机端口，不读取生产凭据。
- `Server/server.source.mjs` 与 `Server/web.mjs` 经 esbuild 生成单文件 `Server/server.mjs`；测试针对该生成物运行，发布网关的三文件白名单不需改变。
- 真实浏览器本机预览验证密码登录、行动/DDL 两个主入口、置顶排序、逾期强调、日期型 DDL、连续秒级倒计时、30 秒读取逻辑与安全退出。新增恢复页面会在读取后立即从地址栏移除令牌 fragment，不写入 `sessionStorage` 或页面正文；桌面和 390×844 窄屏均无横向溢出，控制台没有警告或错误。
- SwiftPM 29 项、Apple XCTest 32 项通过；iOS 主应用与 Live Activity Widget、macOS 构建成功，工程静态校验和单文件二次生成一致性通过。新增测试覆盖 task/project/reminder/milestone 跨类型的重要性排序，以及完成、关闭提醒或改期后拒绝旧通知操作。
- iOS 模拟器实际显示行动与行动组的统一列表、仅“行动/DDL”的主导航、逾期与未来 DDL、锁屏实时活动和灵动岛倒计时。最大辅助字号下复核了行动和 DDL：长标题不截断，状态与完整日期纵向排列，倒计时卡片无重叠或横向溢出。应用内、锁屏实时活动与灵动岛倒计时会在“减弱动态效果”开启时停用数字过渡，并向 VoiceOver 暴露简洁的截止状态和自然语言时长；进度条不重复播报。模拟器本地通知权限和横幅投递已验证。
- 生产当前已发布版本 `fb2010777a4f8af5ebf88b4de0fe06eb7388686a` 的 `/health`、未登录 workspace 401、AASA、通行密钥 challenge 和 revision 已在正常 TLS 校验下通过；一次性恢复与旧通知操作保护仍只在当前分支，不把本机预览当作生产证据。

## 尚需真实环境验收

- 当前分支发布后，可由服务器本机服务用户为既有账号签发十分钟一次性登记链接，解除“忘记密码且尚无通行密钥”的死锁。用户仍必须在自己的系统 WebAuthn 界面完成生物识别或设备口令；尚未生成生产链接、创建真实通行密钥或验证另一台设备登录与同账号资料互通。
- Apple Developer 的签名描述文件、APS entitlement、APNs provider 凭据、真机登记与真实远程收件尚未完成。`RemotePushEnabled` 保持关闭，不把模拟 payload 当作 APNs 验收。
- 物理触感需真机感受；实时活动已在模拟器显示，但仍需已签名真机确认锁屏、灵动岛、回跳与系统结束行为。
- 后台刷新和静默 push 都由系统尽力调度，不能承诺固定周期或应用退出后的即时同步。完整快照协议遇到双向同记录冲突仍要求用户审阅。
- 本分支只有在独立 CI 通过并获得本次生产发布授权后才能合并；先前 PR 的发布授权不自动覆盖这里。

## 常用验证命令

```sh
npm test
swift test
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme WorkspaceCoreTests -destination 'platform=macOS' test
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme GuangyiWorkSpace-iOS -destination 'platform=iOS Simulator,name=iPhone 18 Pro' build
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme GuangyiWorkSpace-Mac -destination 'platform=macOS' build
python3 Scripts/validate_project.py
```

签名目标和可用模拟器名称因机器而异；命令成功不能替代真实用户验证、APNs 或物理触感验收。
