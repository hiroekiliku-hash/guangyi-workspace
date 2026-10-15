import Foundation
import AuthenticationServices
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@MainActor final class PasskeyAuthorization: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<PasskeyCredential, Error>?
    private var controller: ASAuthorizationController?
    func perform(options: PasskeyChallenge.Options, registering: Bool, expectedHost: String) async throws -> PasskeyCredential {
        guard continuation == nil else { throw WorkspaceFailure.invalid("已有通行密钥请求正在进行。") }
        let rpID = options.rp?.id ?? options.rpId ?? ""
        guard rpID == expectedHost, let challenge = Data(base64URL: options.challenge), !challenge.isEmpty else { throw NativeBackendError.malformed }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpID)
        let request: ASAuthorizationRequest
        if registering {
            guard let user = options.user, let handle = Data(base64URL: user.id) else { throw NativeBackendError.malformed }
            let registration = provider.createCredentialRegistrationRequest(challenge: challenge, name: user.name, userID: handle)
            registration.userVerificationPreference = .required
            request = registration
        } else {
            let assertion = provider.createCredentialAssertionRequest(challenge: challenge)
            assertion.userVerificationPreference = .required
            if let credentials = options.allowCredentials {
                assertion.allowedCredentials = try credentials.map { value in
                    guard let id = Data(base64URL: value.id) else { throw NativeBackendError.malformed }
                    return ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: id)
                }
            }
            request = assertion
        }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            self.controller = controller
            controller.delegate = self; controller.presentationContextProvider = self
            controller.performRequests()
        }
    }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        #if os(iOS)
        return UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
        #else
        return NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
        #endif
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let response: PasskeyCredential.Response
        let credentialID: Data
        if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration {
            guard let attestation = credential.rawAttestationObject else { complete(.failure(NativeBackendError.malformed)); return }
            credentialID = credential.credentialID
            response = .init(clientDataJSON: credential.rawClientDataJSON.base64URL, attestationObject: attestation.base64URL, transports: ["internal"])
        } else if let credential = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
            credentialID = credential.credentialID
            response = .init(clientDataJSON: credential.rawClientDataJSON.base64URL, authenticatorData: credential.rawAuthenticatorData.base64URL,
                signature: credential.signature.base64URL, userHandle: credential.userID.base64URL)
        } else { complete(.failure(NativeBackendError.malformed)); return }
        complete(.success(PasskeyCredential(id: credentialID.base64URL, rawId: credentialID.base64URL, response: response)))
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) { complete(.failure(error)) }
    private func complete(_ result: Result<PasskeyCredential, Error>) {
        let continuation = continuation; self.continuation = nil; controller = nil
        continuation?.resume(with: result)
    }
}
extension Data {
    init?(base64URL: String) {
        let value = base64URL.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        self.init(base64Encoded: value + String(repeating: "=", count: (4 - value.count % 4) % 4))
    }
    var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}
