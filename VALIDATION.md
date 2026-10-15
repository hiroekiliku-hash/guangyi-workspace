# 验证与交付边界

最近更新：2026-10-15，北京时间。本文件记录当前分支可复核的结果；早期 Linux 静态检查已由 Mac、Xcode、模拟器和自动化测试取代。

## 已验证

- Node 24 后端 11 项测试全部通过：网页时区/夏令时倒计时、严格安全响应头和 API 鉴权，以及密码会话、快照冲突、数据回滚、设备约束、静默同步提示、提醒派发、失效设备清理、退出和真实 P-256 WebAuthn 验证。测试运行内存 SQLite 和本机随机端口，不读取生产凭据。
- `Server/server.source.mjs` 与 `Server/web.mjs` 经 esbuild 生成单文件 `Server/server.mjs`；测试针对该生成物运行，发布网关的三文件白名单不需改变。
- 真实浏览器本机预览验证密码登录、行动/DDL 两个主入口、置顶排序、逾期强调、日期型 DDL、连续秒级倒计时、30 秒读取逻辑与安全退出。桌面和 390×844 窄屏均无横向溢出，控制台没有警告或错误。
- SwiftPM 28 项、Apple XCTest 31 项通过；iOS 主应用与 Live Activity Widget、macOS 构建成功，工程静态校验通过。新增测试覆盖 task/project/reminder/milestone 跨类型的重要性排序；远程同步提示加入后对应精确提交的 GitHub Actions authentication/native 检查也全部成功。
- iOS 模拟器实际显示行动与行动组的统一列表、仅“行动/DDL”的主导航、逾期与未来 DDL、锁屏实时活动和灵动岛倒计时。最大辅助字号下复核了行动和 DDL：长标题不截断，状态与完整日期纵向排列，倒计时卡片无重叠或横向溢出。倒计时实现会在“减弱动态效果”开启时停用数字过渡，并向 VoiceOver 暴露自然语言时长。模拟器本地通知权限和横幅投递已验证。
- 生产当前已发布版本的 `/health`、未登录 workspace 401、AASA、通行密钥 challenge 和 revision 已在正常 TLS 校验下通过；本网页分支仍为未发布草稿，不把本机预览当作生产证据。

## 尚需真实环境验收

- 用户需在系统界面自行输入账号密码，创建首枚真实通行密钥；随后验证 iPhone/Mac 或另一台设备的注册、登录和同账号资料互通。助手不读取或代输真实密码。
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
