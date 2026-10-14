import Foundation
import Observation
import Security

struct NativeSession: Codable {
    var accessToken: String
    var refreshToken: String?
    var displayName: String
    var account: String?
}
typealias RemoteWorkspace = VersionedWorkspace
struct RemoteDeviceRegistration: Codable {
    var deviceID: String
    var platform: String
    var token: String
    var bundleID: String
    var environment: String
}
protocol NativeBackendTransport {
    func signIn(baseURL: URL, email: String, password: String) async throws -> NativeSession
    func download(baseURL: URL, token: String) async throws -> RemoteWorkspace
    func upload(baseURL: URL, token: String, snapshot: WorkspaceState, expectedRevision: Int) async throws -> RemoteWorkspace
    func register(baseURL: URL, token: String, device: RemoteDeviceRegistration) async throws
    func signOut(baseURL: URL, token: String, deviceID: String?) async throws
}
enum NativeBackendError: LocalizedError {
    case configuration, authentication, conflict, status(Int), malformed, insecureURL
    var errorDescription: String? {
        switch self {
        case .configuration: "请先配置自建服务器并登录。"
        case .authentication: "登录已失效，请重新登录。"
        case .conflict: "服务器数据已被其他设备修改。请先下载并审阅，避免覆盖。"
        case .status(let status): "服务器返回错误 \(status)。请确认后端符合随工程提供的接口契约。"
        case .malformed: "服务器返回的数据格式无效。"
        case .insecureURL: "服务器地址必须使用 HTTPS，不能包含用户名、密码或查询参数。"
        }
    }
}
struct URLSessionBackend: NativeBackendTransport {
    private struct Envelope<T: Decodable>: Decodable { var data: T }
    private struct Login: Encodable { var email: String; var password: String }
    private struct Upload: Encodable { var snapshot: WorkspaceState }
    private func request(_ baseURL: URL, path: String, method: String = "GET", token: String? = nil, data: Data? = nil, revision: Int? = nil) async throws -> Data {
        let url = baseURL.appendingPathComponent("api").appendingPathComponent("native").appendingPathComponent("v1").appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = method; request.httpBody = data; request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if data != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let revision { request.setValue("\"\(revision)\"", forHTTPHeaderField: "If-Match") }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration, delegate: NoBackendRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (body, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw NativeBackendError.malformed }
        if response.statusCode == 401 { throw NativeBackendError.authentication }
        if response.statusCode == 409 || response.statusCode == 412 { throw NativeBackendError.conflict }
        guard (200...299).contains(response.statusCode) else { throw NativeBackendError.status(response.statusCode) }
        guard body.count <= 128 * 1024 * 1024 else { throw WorkspaceFailure.tooLarge }
        return body
    }
    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try ArchiveService.decoder().decode(Envelope<T>.self, from: data).data }
        catch { throw NativeBackendError.malformed }
    }
    func signIn(baseURL: URL, email: String, password: String) async throws -> NativeSession {
        try decode(NativeSession.self, await request(baseURL, path: "session", method: "POST", data: JSONEncoder().encode(Login(email: email, password: password))))
    }
    func download(baseURL: URL, token: String) async throws -> RemoteWorkspace {
        let result = try decode(RemoteWorkspace.self, await request(baseURL, path: "workspace", token: token))
        try WorkspaceLogic.validate(result.snapshot)
        return result
    }
    func upload(baseURL: URL, token: String, snapshot: WorkspaceState, expectedRevision: Int) async throws -> RemoteWorkspace {
        let result = try decode(RemoteWorkspace.self, await request(baseURL, path: "workspace", method: "PUT", token: token,
            data: ArchiveService.encoder().encode(Upload(snapshot: snapshot)), revision: expectedRevision))
        try WorkspaceLogic.validate(result.snapshot)
        return result
    }
    func register(baseURL: URL, token: String, device: RemoteDeviceRegistration) async throws {
        _ = try await request(baseURL, path: "devices", method: "PUT", token: token, data: JSONEncoder().encode(device))
    }
    func signOut(baseURL: URL, token: String, deviceID: String?) async throws {
        if let deviceID {
            _ = try await request(baseURL, path: "devices", method: "DELETE", token: token,
                data: JSONEncoder().encode(["deviceID": deviceID]))
        }
        _ = try await request(baseURL, path: "session", method: "DELETE", token: token)
    }
}
private final class NoBackendRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
enum SecureCredentials {
    private static var service: String { (Bundle.main.bundleIdentifier ?? "GuangyiWorkspace") + ".session" }
    static func save(_ value: String, key: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        let update: [String: Any] = [kSecValueData as String: Data(value.utf8)]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw WorkspaceFailure.invalid("无法更新 Keychain 凭据。") }
        var attributes = query
        attributes[kSecValueData as String] = Data(value.utf8)
        #if os(iOS)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        #endif
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
            throw WorkspaceFailure.invalid("无法将登录凭据保存到 Keychain。")
        }
    }
    static func read(_ key: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func remove(_ key: String) {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key] as CFDictionary)
    }
}
@MainActor @Observable final class BackendService {
    private struct Credentials: Codable {
        var serverOrigin: String
        var accessToken: String
        var refreshToken: String?
        var account: String?
    }
    private static func storedCredentials() -> Credentials? {
        guard let value = SecureCredentials.read("session") else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: Data(value.utf8))
    }
    var address: String {
        didSet {
            UserDefaults.standard.set(address, forKey: "backendAddress")
            signedIn = Self.storedCredentials()?.serverOrigin == address
            revision = nil
        }
    }
    private(set) var signedIn: Bool
    private(set) var displayName: String
    private(set) var revision: Int?
    private(set) var lastSync: Date?
    private(set) var deviceRegistrationStatus = "尚未注册"
    private let transport: NativeBackendTransport
    init(transport: NativeBackendTransport = URLSessionBackend()) {
        self.transport = transport
        let configured = UserDefaults.standard.string(forKey: "backendAddress") ?? ""
        let savedAddress = configured.isEmpty ? "https://workspace.kdfz.com.cn" : configured
        address = savedAddress
        signedIn = Self.storedCredentials()?.serverOrigin == savedAddress
        displayName = UserDefaults.standard.string(forKey: "backendDisplayName") ?? ""
    }
    private func baseURL() throws -> URL {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
            throw NativeBackendError.insecureURL
        }
        // Tokens are host-bound, so changing the address never sends an old token elsewhere.
        return url
    }
    private func credentials() throws -> (URL, String) {
        let url = try baseURL()
        guard let credentials = Self.storedCredentials(), credentials.serverOrigin == url.absoluteString else {
            throw NativeBackendError.configuration
        }
        return (url, credentials.accessToken)
    }
    func signIn(email: String, password: String) async throws {
        let url = try baseURL()
        let result = try await transport.signIn(baseURL: url, email: email, password: password)
        guard try baseURL() == url else { throw NativeBackendError.configuration }
        guard !result.accessToken.isEmpty else { throw NativeBackendError.malformed }
        let credentials = Credentials(serverOrigin: url.absoluteString, accessToken: result.accessToken, refreshToken: result.refreshToken, account: result.account ?? email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        let encoded = try JSONEncoder().encode(credentials)
        guard let value = String(data: encoded, encoding: .utf8) else { throw NativeBackendError.malformed }
        try SecureCredentials.save(value, key: "session")
        address = url.absoluteString
        signedIn = true; displayName = result.displayName; revision = nil
        UserDefaults.standard.set(displayName, forKey: "backendDisplayName")
    }
    func signOut() async throws {
        defer {
            for key in ["session", "accessToken", "refreshToken", "serverOrigin"] { SecureCredentials.remove(key) }
            signedIn = false; displayName = ""; revision = nil
            UserDefaults.standard.removeObject(forKey: "backendDisplayName")
        }
        if let credentials = Self.storedCredentials(), let url = URL(string: credentials.serverOrigin) {
            do {
                try await transport.signOut(baseURL: url, token: credentials.accessToken,
                    deviceID: UserDefaults.standard.string(forKey: "deviceID"))
            } catch { throw WorkspaceFailure.invalid("本机凭据已清除，但服务器暂时不可达，远程会话可能要到期后才失效。") }
        }
    }
    var accountScope: String? {
        guard signedIn, let value = Self.storedCredentials(), value.serverOrigin == address, let account = value.account, !account.isEmpty else { return nil }
        return value.serverOrigin + "|" + account
    }
    func downloadForSync(scope: String) async throws -> RemoteWorkspace {
        guard accountScope == scope else { throw NativeBackendError.configuration }
        let (url, token) = try credentials()
        let result = try await transport.download(baseURL: url, token: token)
        guard accountScope == scope else { throw NativeBackendError.configuration }
        return result
    }
    func uploadForSync(_ snapshot: WorkspaceState, revision: Int, scope: String) async throws -> RemoteWorkspace {
        guard accountScope == scope else { throw NativeBackendError.configuration }
        let (url, token) = try credentials()
        let result: RemoteWorkspace
        do { result = try await transport.upload(baseURL: url, token: token, snapshot: snapshot, expectedRevision: revision) }
        catch NativeBackendError.conflict { throw WorkspaceSyncError.revisionChanged }
        guard accountScope == scope else { throw NativeBackendError.configuration }
        return result
    }
    func acknowledgeSync(_ result: RemoteWorkspace) { revision = result.revision; lastSync = Date() }
    func download() async throws -> WorkspaceState {
        let (url, token) = try credentials()
        let result = try await transport.download(baseURL: url, token: token)
        revision = result.revision; lastSync = Date()
        return result.snapshot
    }
    func upload(_ state: WorkspaceState) async throws {
        let (url, token) = try credentials()
        guard let revision else { throw WorkspaceFailure.invalid("请先下载服务器快照并审阅，然后再上传。") }
        let result = try await transport.upload(baseURL: url, token: token, snapshot: state, expectedRevision: revision)
        self.revision = result.revision; lastSync = Date()
    }
    func registerDevice(_ token: Data) async throws {
        let (url, access) = try credentials()
        let existing = UserDefaults.standard.string(forKey: "deviceID") ?? UUID().uuidString
        UserDefaults.standard.set(existing, forKey: "deviceID")
        #if os(macOS)
        let platform = "macOS"
        #else
        let platform = "iOS"
        #endif
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        try await transport.register(baseURL: url, token: access, device: RemoteDeviceRegistration(deviceID: existing, platform: platform,
            token: token.map { String(format: "%02x", $0) }.joined(), bundleID: Bundle.main.bundleIdentifier ?? "", environment: environment))
        deviceRegistrationStatus = "已注册"
    }
}

struct PasskeyChallenge: Decodable {
    struct Options: Decodable {
        struct RP: Decodable { var id: String }
        struct User: Decodable { var id: String; var name: String }
        struct Descriptor: Decodable { var id: String }
        var challenge: String
        var rp: RP?
        var rpId: String?
        var user: User?
        var excludeCredentials: [Descriptor]?
        var allowCredentials: [Descriptor]?
    }
    var challengeID: String
    var options: Options
}
struct PasskeyCredential: Encodable {
    struct Response: Encodable {
        var clientDataJSON: String
        var attestationObject: String?
        var authenticatorData: String?
        var signature: String?
        var userHandle: String?
        var transports: [String]?
    }
    var id: String
    var rawId: String
    var type = "public-key"
    var authenticatorAttachment = "platform"
    var clientExtensionResults: [String: String] = [:]
    var response: Response
}
struct RegisteredPasskeys: Decodable {
    struct Credential: Decodable, Identifiable { var id: String; var created: Double }
    var credentials: [Credential]
}
extension URLSessionBackend {
    func passkeyOptions(baseURL: URL, registering: Bool, token: String?) async throws -> PasskeyChallenge {
        try decode(PasskeyChallenge.self, await request(baseURL, path: registering ? "passkeys/register/options" : "passkeys/login/options", method: "POST", token: token, data: Data("{}".utf8)))
    }
    func verifyPasskey(baseURL: URL, challengeID: String, credential: PasskeyCredential) async throws -> NativeSession {
        struct Proof: Encodable { var challengeID: String; var credential: PasskeyCredential }
        return try decode(NativeSession.self, await request(baseURL, path: "passkeys/login/verify", method: "POST", data: JSONEncoder().encode(Proof(challengeID: challengeID, credential: credential))))
    }
    func registerPasskey(baseURL: URL, token: String, challengeID: String, credential: PasskeyCredential) async throws {
        struct Proof: Encodable { var challengeID: String; var credential: PasskeyCredential }
        _ = try await request(baseURL, path: "passkeys/register/verify", method: "POST", token: token, data: JSONEncoder().encode(Proof(challengeID: challengeID, credential: credential)))
    }
    func passkeys(baseURL: URL, token: String) async throws -> RegisteredPasskeys {
        try decode(RegisteredPasskeys.self, await request(baseURL, path: "passkeys", token: token))
    }
    func revokePasskey(baseURL: URL, token: String, id: String) async throws {
        _ = try await request(baseURL, path: "passkeys", method: "DELETE", token: token, data: JSONEncoder().encode(["id": id]))
    }
}
extension BackendService {
    func signInWithPasskey(using authorization: PasskeyAuthorization) async throws {
        let url = try baseURL()
        let endpoint = URLSessionBackend()
        let options = try await endpoint.passkeyOptions(baseURL: url, registering: false, token: nil)
        let credential = try await authorization.perform(options: options.options, registering: false, expectedHost: url.host ?? "")
        let result = try await endpoint.verifyPasskey(baseURL: url, challengeID: options.challengeID, credential: credential)
        guard let account = result.account, !account.isEmpty, !result.accessToken.isEmpty else { throw NativeBackendError.malformed }
        guard try baseURL() == url else { throw NativeBackendError.configuration }
        let saved = Credentials(serverOrigin: url.absoluteString, accessToken: result.accessToken, refreshToken: result.refreshToken, account: account)
        let value = try JSONEncoder().encode(saved)
        try SecureCredentials.save(String(decoding: value, as: UTF8.self), key: "session")
        address = url.absoluteString; signedIn = true; displayName = result.displayName; revision = nil
        UserDefaults.standard.set(displayName, forKey: "backendDisplayName")
    }
    func addPasskey(using authorization: PasskeyAuthorization) async throws {
        let (url, token) = try credentials()
        let scope = accountScope
        let endpoint = URLSessionBackend()
        let options = try await endpoint.passkeyOptions(baseURL: url, registering: true, token: token)
        let credential = try await authorization.perform(options: options.options, registering: true, expectedHost: url.host ?? "")
        guard accountScope == scope, try credentials().1 == token else { throw NativeBackendError.configuration }
        try await endpoint.registerPasskey(baseURL: url, token: token, challengeID: options.challengeID, credential: credential)
    }
    func registeredPasskeys() async throws -> RegisteredPasskeys {
        let (url, token) = try credentials()
        return try await URLSessionBackend().passkeys(baseURL: url, token: token)
    }
    func revokePasskey(_ id: String) async throws {
        let (url, token) = try credentials()
        try await URLSessionBackend().revokePasskey(baseURL: url, token: token, id: id)
    }
}
