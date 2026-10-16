# Native passkeys

Native passkeys are paused in the default Personal Team test configuration.
Both application Info.plists set `NativePasskeysEnabled` to false; the login UI
and native service entry points respect this switch. Password login remains
available. The default iOS entitlements request neither Associated Domains nor
APNs. Web passkeys and backend endpoints remain enabled.

The Personal Team build can also use the dedicated `/native-login` page through
the system web authentication session. That page supports password login and
existing web passkeys without requiring the application's Associated Domains
entitlement. It holds credentials only in memory and never shares the regular
website's sessionStorage. On success it requests a 90-second, single-use code
bound to S256 PKCE and the native client's random state, revokes its temporary
browser bearer, and offers a button to return to
`guangyi-workspace://auth/callback`. This callback contains only a code and state.
The native client validates state and exchanges the code plus its verifier over
HTTPS for its own account session. No passkey private key enters the App or the
callback URL. Details and error behavior are in `API-CONTRACT.md`.

To re-enable native passkeys later with a capable signing team, use
`Config/iOS-Passkeys.entitlements` (or `Config/Mac-Passkeys.entitlements`), obtain
matching provisioning, and set the application's `NativePasskeysEnabled` to true.
Keep the current defaults for Personal Team testing.

The canonical backend source is `Server/server.source.mjs`. `npm ci && npm test`
locks SimpleWebAuthn 14.0.0 and esbuild 0.28.2, generates the single-file
`Server/server.mjs` artifact, and tests that exact artifact. The release gateway
still receives only server.mjs, server.test.mjs, and REVISION; its allowlist,
privileges, database path, backup/rollback behavior, and runtime are unchanged.
Bundled third-party license notices are retained in server.mjs.

Authenticated registration:
- POST /api/native/v1/passkeys/register/options
- POST /api/native/v1/passkeys/register/verify with {challengeID, credential}

Discoverable login:
- POST /api/native/v1/passkeys/login/options
- POST /api/native/v1/passkeys/login/verify with {challengeID, credential}

Credential management:
- GET /api/native/v1/passkeys (authenticated)
- DELETE /api/native/v1/passkeys with {id} (authenticated)

Password-loss recovery:
- A local server operator runs `node server.mjs issue-passkey-recovery <database-path> [account-email]`.
- The command prints a ten-minute HTTPS URL whose secret stays in the URL fragment.
- POST /api/native/v1/passkeys/recovery/options with `{token}` starts registration.
- POST /api/native/v1/passkeys/recovery/verify with `{token, challengeID, credential}` finishes registration and returns a scoped session.

The recovery command needs direct filesystem access to the SQLite database; there
is no public endpoint that creates recovery links. Only a SHA-256 token hash is
stored. Issuing a new link invalidates the older link for that account. The link
is issued in a SQLite write transaction with a one-active-link-per-account
constraint. It is consumed in the same transaction that saves the verified
public key, and expires after ten minutes. The browser removes the fragment from
its address bar before sending any request. It never submits the token in a URL,
server log, referrer, or long-term browser storage.

Registration attaches a new passkey to the existing authenticated account. It
never recreates an account or changes its workspace. Challenges are random,
expire after five minutes, are stored in SQLite, and are atomically consumed.
Registration challenges are bound to the exact authenticated session. Both
ceremonies require user verification and validate challenge, origin, RP ID and
credential signature. Authentication counters are updated conditionally.
The verified account email is returned with each successful session so native
sync can bind its local checkpoint to an authenticated account identity.
Private keys remain on the authenticator. The server stores public keys only.

The same-origin read-only web client supports discoverable login and lets an
already authenticated account register a new passkey. It serializes browser
WebAuthn binary fields as base64url and uses the same endpoints and validation
as the native clients. The bearer session remains in tab-scoped sessionStorage;
the page never receives or stores authenticator private-key material.

Database changes are additive tables: passkey_users, passkeys,
passkey_challenges, passkey_recoveries and web_auth_codes. Existing accounts, sessions and
workspace rows are retained.
An older release can still read the database after a code rollback; rollback
continues not to restore the database.

Defaults are PASSKEY_RP_ID=workspace.kdfz.com.cn and
PASSKEY_ORIGIN=https://workspace.kdfz.com.cn. PASSKEY_APP_IDS is a comma-separated
list of verified TeamID.BundleID values. Current defaults use the native iOS
team 67WBP6S5QL and com.guangyi.workspace.native.ios / .mac. macOS must actually
be signed and provisioned for that team before it can use that association.

GET /.well-known/apple-app-site-association serves the webcredentials association
without an API envelope. Verify Nginx forwards that path and Apple's CDN can
read it after deployment. Apple Developer Associated Domains capability and
matching entitlements/provisioning profiles are also necessary. Native system
registration, physical user verification and two-device login are still
required acceptance steps; synthetic signature tests do not prove them.
