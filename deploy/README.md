# Dedicated production deployment

API: https://workspace.kdfz.com.cn
Repository: https://github.com/hiroekiliku-hash/guangyi-workspace

Push trusted code to main. Actions checks out the exact SHA, tests on Node 24.21.0 and streams a digest-checked archive through a dedicated forced-command key. The public deployed SHA must match. Pull requests receive no deployment credentials.

Secrets: GUANGYI_DEPLOY_KEY, GUANGYI_KNOWN_HOSTS. The key provides only status, deploy, rollback; no shell, scp, SFTP or forwarding. Never reuse travel credentials.

Manual dispatch supports status and rollback to a retained full 40-character SHA. Releases and consistent SQLite backups are retained; monitor disk use. Rollback changes code, never restores the database. Incompatible database migrations need a separate recovery plan.

The root-owned gateway at /opt/guangyi-workspace/deploy-channel/gateway.py requires separate administrator review/installation when changed in Git. Production code is at releases/<SHA>, selected by current. Original installation is preserved in releases/legacy and first-install-preserved-20261014. Do not rerun the first-install script.

Certificate renewal uses certbot-renew.timer and the dedicated lineage-filtered guangyi-workspace-reload hook. Nginx is tested then reloaded. Environment, data, ACME and other projects stay outside code releases.

Sync remains manual snapshots. Native signing, real APNs and automatic background sync are separate unfinished work.
