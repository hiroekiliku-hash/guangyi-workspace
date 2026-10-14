# 验证与交付边界

本次环境为 Linux；没有 Swift 编译器、Xcode、Apple SDK、iPhone 模拟器或真实 Apple 设备。

## 实际执行

- 24 个 Swift 文件（21 个应用共享源文件、2 个测试文件、Package.swift）使用 tree-sitter-swift 解析，全部没有语法错误节点；这是语法检查，不是 Swift 编译或 Apple SDK 类型检查。
- Xcode project.pbxproj 的 114 个对象使用 OpenStep parser 解析通过；三个目标、所有 Sources/Resources 引用、共享 scheme 和构建文件路径检查通过。
- Info.plist、entitlement、asset catalog 和图标尺寸检查；iPhone/Mac 使用同一组业务与界面源文件。
- Node 后端 7 项本地 HTTP/SQLite 测试通过：鉴权、快照版本冲突、校验拒绝且不增版本、设备注册约束、后台去重与完成排除、失效设备清理、会话撤销。
- 后端与维护 Python 脚本语法检查通过。
- 源码包的 SHA-256 清单和 ZIP 完整性校验。
- 只读域名检查：kdfz.com.cn 在当前解析器指向 146.56.249.84，代理路径 HTTPS HEAD 返回 200；workspace.kdfz.com.cn 当前未解析，代理 HTTPS 请求返回 403，不代表目标服务器拒绝。
- 后续检查确认 workspace.kdfz.com.cn 已解析到服务器，但根路径与 /health 返回旧地图网站 HTML，原生 workspace 接口为 404；广益后端尚未上线。用户提供 root 网页终端、SSH 配置和 DNSPod 主账号管理页面证据。
- 用户后来在 OrcaTerm 首装成功并提供输出：服务器上的 7 项测试通过，BACKEND_READY、127.0.0.1:8087、本机健康 JSON ok、未登录 401。专用 HTTPS 配置脚本只完成 Bash 语法检查，尚未在服务器执行。

## 未执行

- xcodebuild build/test、swift test、SwiftData 宏展开和 Apple SDK 编译。
- iPhone/Mac 布局、运行、真实本地通知、系统日历或照片权限验收。
- Apple APNs provider 凭据、签名设备注册与真实收件。
- Cloud 到服务器的管理员 SSH、专用 HTTPS 路由与证书配置、自动发布通道。用户已首装本机后端；剩余任务转交本地 Codex，见 LOCAL-CODEX-HANDOFF.txt。
- 自动设备同步、生产数据迁移和原 Sites 服务更新。

工程提供 13 项纯业务 XCTest、2 项 Apple 加密/SwiftData 测试，供在 Mac/Xcode 中运行。本次不声称这些 XCTest 已经通过。

如 Xcode 报错，请提供完整错误与 Xcode 版本；静态语法与工程引用检查不能替代 Apple 平台编译。原网页的完整 Markdown/KaTeX 渲染、备份格式与用户管理不等于已在原生版实现。
