# Playbook: Update CLI Release Behavior

1. Check `package.json`, `CHANGELOG.md`, `README.md`, and update-notifier
   behavior in `src/cli.ts`.
2. Preserve the update protocol in `docs/SAFETY.md`: never run a global install
   command without explicit current-turn user approval.
3. If daemon behavior changes after upgrade, document whether
   `1688 daemon reload` is required.
4. Run `pnpm build`, `pnpm test`, and `pnpm agent-context`.
5. Update docs when install, postinstall, or release packaging behavior changes.

