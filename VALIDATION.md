# 验证与交付边界

2026-10-16 网页登录与自动合并：Personal Team 客户端使用 ASWebAuthenticationSession，网页支持账号密码与已有通行密钥；固定回调只带 90 秒一次性授权码和 state，S256 PKCE 兑换后把账号作用域会话存入 Keychain。浏览器临时 Bearer 在授权事务中撤销，专用页不写浏览器 storage，也不读写工作空间。App 内账号密码入口保留；两种入口登录成功后自动合并并开启同步，首次冲突直接进入比较，网络失败可重试。原生通行密钥及 APNs 权限仍关闭。

本轮最小本地验证：4 项 WebLogin 核心协议测试、7 项后端 web auth 定向测试通过；实际 Swift URLSession 与临时 Node/内存 SQLite 的 14 项检查通过，包含 PKCE 回调与兑换、临时会话撤销、重放拒绝、双向合并和冲突保留，finalRevision=7，不访问 Keychain 或生产数据。一次 iPhone 17 Pro 模拟器增量构建退出码 0。日志为顶层 LocalVerification/web-login-client-tests.log、web-login-ios-build.log，原生协议报告为 web-login-native-sync.json。系统认证窗口交互与实体 iPhone 登录尚待实际运行，不能用协议测试或编译代替。生产发布与真实账号核验记录另行保存。

2026-10-16 事项时间与重复：编辑页明确区分计划时间、可选截止、系统通知；显示提醒依据及实际通知时刻，自定义提醒不再叠加提前量。普通事项（TASK、REMINDER、MILESTONE）和截止事项均可新建时原子保存重复规则，或通过详情设置；支持每天、每周/隔周、单周、双周、周一至周五、中国大陆含调休工作日及每月。教学单双周有可设的第1周周一并连续跨年；计划、截止、自定义提醒一起按当地日历移动，保留时区及夏令时行为。首页和默认列表按重复分组。旧日/周/月规则与归档可读，新频率需要两端客户端同时更新。

工作日仅内置已核实的2025—2026年国务院放假/补班安排，来源链接见 README 和 ChinaWorkCalendar。未知年份不生成、不猜测，也不把生成进度推进到未覆盖年份；后续需更新内置日历，学校另行补课不自动套用。停止重复保留过去及已完成实例，关闭未来未完成实例。稳定 UUID v5 和确定的初始元数据避免多设备离线生成重复项；生成缓存进度可合并，一端停止后另一端离线新增的未修改未来实例在合并时关闭提醒。

最终49项 SwiftPM、53项 Apple XCTest和11项原生URLSession/临时本机API同步检查通过；覆盖春节和国庆调休、周末补班、未知年份、单双周跨年、三种时间跨DST、普通事项初始状态、停止重复、离线去重/停止竞态、SwiftData与加密归档。日志 item-recurrence-core-tests.log、item-recurrence-apple-tests.log；报告 item-recurrence-native-sync.json，finalRevision=7。iPhone 17 Pro模拟器、Mac、Personal Team iPhone最终构建均退出码0，应用和扩展签名核验通过；默认原生通行密钥/APNs仍关闭。初次Mac和签名构建的自动审批均超时且未执行，按工具许可各重试一次后成功，最终源码变化后的构建另行通过。

实际iPhone 17 Pro/iOS27界面验收使用正式模拟器应用及 --ui-smoke 内存样本，无临时改版或新增启动钩子。经辅助功能列表进入新建事项，实际核对计划与可选截止说明、提醒依据/实际通知、自定义提醒切换、七种频率、工作日日期预览、单周星期及第1周基准和两周递进预览。原始截图 item-times-iphone17pro.jpg、item-reminder-iphone17pro.jpg、item-custom-reminder-iphone17pro.jpg、item-repeat-options-iphone17pro.jpg、item-workdays-iphone17pro.jpg、item-week-reference-iphone17pro.jpg、item-odd-week-preview-iphone17pro.jpg。仅操作内存样本，取消了未保存草稿并恢复默认样本首页；GUI保存按钮点击及实体机通知送达不在本次已验收范围，保存/生成/同步由业务、持久化、API验收覆盖。未操作真机、访问生产资料或发布服务器。

2026-10-16 设置入口去重：iPhone 首页及其他主页面的齿轮按钮直接打开 SettingsView；移除旧 MoreView 中转页及“个人资料与设置”/“设置”两个重复链接。个人资料在统一设置页直接编辑，知识库、日历、时间线、归档及回收站移入 iPhone 设置页的“工作空间”分区；Mac 保留原侧栏工具入口。旧 .more 视图路由映射到统一设置页。iPhone 17 Pro 模拟器目标、Mac 和 Personal Team iPhone 签名构建均退出码 0，主应用与扩展签名核验通过，日志 settings-navigation-*-build.log；项目静态校验通过。签名构建首次自动审批超时且未执行，按工具允许重试一次后成功。新版已在专用 iPhone 17 Pro / iOS 27 模拟器以内存样本启动；实际齿轮点击验收未完成，原因是 Device Hub 的辅助功能树未列出顶部导航按钮，坐标点击返回 noWindowsAvailable，不能将源码与构建成功当作点击验收。报告 settings-navigation-validation.json。未操作真机或发布服务器。

2026-10-16 更名：原生应用对外统一为“工作坊”，设置中的英文名称为 WorkSpace；系统显示名与 CFBundleName、通知标题和权限提示、应用弹窗、Mac 侧栏、实时活动扩展、归档类型描述及默认导出文件名均同步调整。生成脚本同步维护命名。iPhone 17 Pro / iOS 27 模拟器实际确认桌面图标名称为“工作坊”，原始截图 rename-iphone17pro-home.jpg；“关于”页文字已通过源码与编译核对。模拟器、Mac 和原 Team 的 iPhone 签名构建均退出码 0，日志 rename-ios-build.log、rename-mac-build.log、rename-personal-team-build.log；所有生成产物的显示名及 Bundle 名已核对，iPhone 主应用与扩展签名通过。Bundle ID、Team、SwiftData 配置名、URL scheme 和归档类型标识沿用原值；默认原生通行密钥和 APNs 仍关闭。没有操作真机或发布服务器。

主要目标机型：用户明确指定 iPhone 17 Pro。独立验收模拟器设备类型为 com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro（型号标识 iPhone18,1），不是重命名的 iPhone 18 Pro；Apple 配置屏幕为 1206×2622@3×、402×874pt。当前模拟器系统 iOS 27，不代表实体机系统版本。机型专用验收结果见 island-17pro-validation.json。

主要目标的实际系统验收已通过：iPhone 17 Pro 紧凑态短计时 4:06 位于右侧且无额外尾部宽框；展开态 4:22 与两行长标题、完整截止时间均在安全边距内；恢复正式源码编译的普通应用后，唤醒锁屏的 1:59:07 小时级计时完整显示，并与截止信息右边缘对齐。原始 Device Hub 截图 island-17pro-compact-short.jpg、island-17pro-expanded-long.jpg、island-17pro-lock-hours.jpg，未经编辑。锁屏秒级显示验收使用唤醒态，常亮低刷新状态不作为秒级准确性证据。短计时和展开态使用临时应用入口与内存样本，Widget SHA256 与下文正式源码一致；本地 ActivityKit 更新调出系统展开态，不依赖 APNs。两个测试活动均已结束，普通模拟器应用已恢复；临时入口未进入正式源码，未操作真机。

2026-10-16 用户截图修正：上版计时仅对齐外框，未对齐系统计时文字，固定宽框在短计时中造成空位和悬空；展开态默认边距也不能保证内容避开圆角。现改为隐藏的静态宽度样本提供有限尺寸，系统计时文字明确靠右，删除 48/92/128pt 固定框；展开横向边距 24pt、底部 20pt，锁屏留白 16pt。参考 Apple Text(timerInterval:pauseTime:countsDown:showsHours:) 文档中关于归档后弹性宽度与 multilineTextAlignment 的说明。

本轮正式源码的模拟器构建和 Personal Team iPhone 签名构建均退出码 0，主应用与扩展签名核验通过，未重新引入 Associated Domains 或 APNs。日志 island-correction-simulator-build.log / island-correction-personal-team-build.log。首次签名命令的自动审批超时未执行；按工具允许重试一次后成功，未绕过审批。

实际系统验收使用临时模拟器项目，Widget 与正式源码逐字相同，SHA256 为 015b4889d74539c86d6829b143409a48390ed57780d439a6b26efc49623f21c5；仅应用的内存样本入口增加本地 ActivityKit 更新以调出展开态，没有将自动更新测试入口加入正式源码，也不依赖 APNs。核对了与用户截图接近的 h 标题、四分多钟倒计时、完整截止时间，以及两行长标题。紧凑态右侧无多余宽框；展开态全部文字在安全区内；锁屏计时与右侧截止信息对齐。系统短暂展开由连续原始截图记录，未经编辑。证据为 island-correction-compact-short.png、island-correction-expanded-long.png、island-correction-lock-long.png；这些均为 Device Hub 截图，包含系统灵动岛，不使用 simctl 截图冒充。未操作真机或真实资料。本节更新取代下文上版“展开态未展示”的结论。

最近更新：2026-10-16，北京时间。按用户最新要求，默认测试构建暂停原生通行密钥和 APNs，以现有 Personal Team 完成 iPhone 目标编译与签名。保留本地通知、触感、灵动岛、实时活动、密码同步和系统后台刷新。未安装或操作真机，未发布服务。

用户直接打开的顶层工程已执行 generic/platform=iOS、Debug、正常签名构建，退出码 0，日志 personal-team-device-build.log 记录 BUILD SUCCEEDED。主应用和 Widget 的签名核验通过，均使用原 Team 67WBP6S5QL；签名产物不含 Associated Domains 或 APNs entitlement。主应用嵌入描述文件有效至 2026-10-21 15:41:06 北京时间，扩展至同日 16:40:54；到期后需在 Xcode 重新签名运行。核验报告 personal-team-signing.json。未指定 CODE_SIGNING_ALLOWED=NO，未请求 provisioning 更新。

本轮共享代码的 macOS 构建退出码 0；密码登录与双会话同步本机端到端验收八项再次通过，报告 personal-team-native-sync.json。默认开关及 entitlement 静态检查通过。以上日志与报告均在顶层 LocalVerification。

同日灵动岛重设计：参考 Apple HIG Live Activities 与 WWDC23 Design dynamic Live Activities，紧凑和展开都保持左侧进度、右侧倒计时；最小态用系统计时进度环传达剩余时间，去除原先静态图标。展开态使用系统默认内容边距，标题与截止信息放到摄像头下方；锁屏使用 14pt 留白，不额外套应用图标容器。通过有限计时宽度修复了第一版锁屏卡片空白的渲染问题。增加 iOS 27 受限宽度处理，SDK 兼容分支保留 iOS 17 支持，并提供四种状态的 Xcode 预览。

最终模拟器构建与 Personal Team iPhone 签名构建均退出码 0，日志 apple-island-simulator-build.log / apple-island-personal-team-build.log。Personal Team 日志含现有的签名二进制不剥离与界面方向警告，无编译错误。最终主应用和 Widget 的签名再次核验通过，Associated Domains 与 APNs 仍不在签名 entitlement 中。模拟器实际核对紧凑态的进度环和倒计时、锁屏两行长标题及计时层级，截图 apple-island-lock-screen.png；iOS 27 Safari 横屏实际只显示 22pt 进度环，宽倒计时隐藏，无裁切。报告 apple-island-validation.json。已恢复竖屏并结束测试实时活动。本轮尚未通过系统长按展示展开态或多活动最小态；Device Hub 坐标输入返回 noWindowsAvailable，不能以源码预览声明替代实际系统展示。先前版本的展开态证据不作为本次重设计的验收证据。未操作真机。

2026-10-16 补充：真实 Swift URLSessionBackend 与打包后的 Node API 本机端到端验收通过。两个独立会话使用临时随机密码、内存 SQLite、127.0.0.1 随机端口；验证账号登录、JSON 日期和父子关联往返、双向离线合并、旧 revision 拒绝且不写入、同记录冲突保护、明确选择后的同步及单会话撤销隔离。最终 revision=5，报告位于顶层 LocalVerification/native-server-sync-acceptance.json。本机 Node 为 v26.8.1；CI 已配置使用生产相同的 24.21.0 执行此项，但尚未推送或运行该新增 CI 步骤。不读写 Keychain、不访问生产、不操作真机。

同日只读复核公网 /health 为 200 且 status=ok，/deploy-revision.json 仍为 647108b44c3ba8e70355751934db1b0b9553045e；使用正常 TLS 验证，没有跳过证书校验。

## 本轮已验证

- SwiftPM 29 项通过，Apple XCTest 32 项通过。覆盖同步合并与冲突、通知操作失效保护、循环规则、实时活动资格、SwiftData 和加密归档。业务 Core 源码本轮未变更。
- iOS 主应用、Live Activity Widget 与 macOS 构建成功；最终 iOS/macOS 编译日志保存在顶层工程的 LocalVerification/design-ios-build.log 和 design-mac-build.log。quiet 日志无诊断，命令退出码为 0。工程静态校验与 git diff --check 通过。
- iOS 默认进入首页，底部为首页、行动、DDL；Mac 主侧栏恢复首页及 ⌘0。首页只聚合行动与 DDL，突出一项待处理 DDL 的逐秒倒计时，下方仅简短摘要。旧行动组、提醒与里程碑继续合入行动入口，不转换或删除数据。
- 详情页标题与状态分层，完成按钮使用明确的图标和完整文字、统一圆角与按压效果；追踪采用次级按钮。不符合追踪条件时显示原因，避免一整块禁用按钮。登录、同步、资料保存与合并操作共用主要按钮样式。
- 本机 iPhone 18 Pro / iOS 27 模拟器已实际核对灵动岛紧凑态、展开态与锁屏卡片。展开态两行长标题、完整倒计时和进度轨道均位于系统区域内，摄像头两侧只留小图标与 DDL 标签；保留系统顶部安全边距。锁屏长标题可显示两行，计时与截止时间分层。最小态代码和编译通过，本轮未制造第二个活动进行系统最小态展示。
- 最大辅助字号下，详情长标题可完整换行，倒计时与“标记完成”按钮没有横向溢出；实际点击完成后倒计时、活动追踪状态和结束按钮正确消失，并显示不可再追踪的原因。验收使用 DEBUG --ui-smoke 内存样本，未向真实存储或生产上传测试记录。
- 触感覆盖主导航、新建、筛选、编辑状态/提醒选项、主要按钮按下、保存/完成/归档/删除/恢复/循环操作、追踪开始/结束与错误；所有路径遵守触感开关。数字过渡和按钮缩放遵守减弱动态效果。模拟器只能验证逻辑与界面，不能验证物理触感强度。
- 顶层工程和 BackendRepository 的全部本轮修改文件逐字一致，Team 与 Bundle ID 不变。默认 iOS entitlement 改为空字典，Associated Domains 移入可选 iOS-Passkeys.entitlements。两个 Info.plist 关闭 NativePasskeysEnabled 和 RemotePushEnabled，移除默认 remote-notification 后台模式；APNs 调试绕过路径已移除。生成脚本与静态检查同步调整。

## 上轮已完成的认证与后端证据

- 上轮 PR 7 已合并发布，验收 SHA 为 647108b44c3ba8e70355751934db1b0b9553045e，Actions 运行 38754096862 成功；健康、严格 TLS、版本、鉴权边界及 AASA 已通过。本轮没有重新发布或把原生界面源码当作服务器发布证据。
- 真实网页为既有账号创建新通行密钥，独立再次登录成功后已安全退出。只读网页版的行动/DDL、日期型和秒级倒计时、窄屏、排序、恢复令牌清理等此前已验收。
- Node 24 后端 13 项测试此前通过，覆盖真实 P-256 WebAuthn 验证、一次性恢复、会话、版本冲突、设备约束、静默同步提示与通知派发；本轮服务端源码未修改。

## 当前系统与凭据限制

- 此前 Personal Team 不支持 Associated Domains 的错误已通过移除默认 entitlement 解决，当前默认 iPhone 构建及签名通过。原生通行密钥按用户要求暂停，入口隐藏且服务层拒绝调用；不再作为当前测试交付阻塞项。
- APNs 按用户要求暂停；provider Team ID、Key ID 与 .p8 私钥未配置，未尝试注册或收件。恢复原生通行密钥/APNs 后仍需具备对应能力的签名与独立验收。
- 后台刷新和静默推送由系统尽力调度，不能保证固定周期或应用退出后的即时同步。完整快照协议遇到同记录冲突仍需审阅。
- 用户已要求停止手机操作。本轮未安装、启动、卸载或测试真机应用，也不以模拟器证明物理触感或原生跨设备生产同步。

## 图形证据说明

顶层 LocalVerification 中的 design-lock-screen.png、design-buttons-accessibility-xxxl.png 等为本机模拟器证据。当前 simctl 截图不包含系统灵动岛叠层，不能证明灵动岛布局；灵动岛由 Device Hub 的 iPhone 18 Pro 模拟器窗口截图实际观察，工具记录可复核。invalid-simctl-design-island-expanded.png 已明确标记无效。

## 常用验证命令

```sh
swift test
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme WorkspaceCoreTests -destination 'platform=macOS' test
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme GuangyiWorkSpace-iOS -destination 'platform=iOS Simulator,name=iPhone 18 Pro' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project GuangyiWorkSpace.xcodeproj -scheme GuangyiWorkSpace-Mac -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO build
python3 Scripts/validate_project.py
python3 Scripts/Acceptance/run-native-server-sync.py
```

本机需将 DEVELOPER_DIR 指向完整 Xcode；沙箱内 SwiftPM 可用 --disable-sandbox 并将模块缓存放在工程 .build，Apple 宏与模拟器服务需要系统服务访问。
