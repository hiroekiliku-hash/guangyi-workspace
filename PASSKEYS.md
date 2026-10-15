# Native passkeys

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

Registration attaches a new passkey to the existing authenticated account. It
never recreates an account or changes its workspace. Challenges are random,
expire after five minutes, are stored in SQLite, and are atomically consumed.
Registration challenges are bound to the exact authenticated session. Both
ceremonies require user verification and validate challenge, origin, RP ID and
credential signature. Authentication counters are updated conditionally.
The verified account email is returned with each successful session so native
sync can bind its local checkpoint to an authenticated account identity.
Private keys remain on the authenticator. The server stores public keys only.

Database changes are additive tables: passkey_users, passkeys and
passkey_challenges. Existing accounts, sessions and workspace rows are retained.
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
