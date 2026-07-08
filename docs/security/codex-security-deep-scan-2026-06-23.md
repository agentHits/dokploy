# Security Remediation Tracker: AgentHits-Dev

> Public-safe tracker for an internal Codex Security deep scan.
> This file intentionally redacts vulnerability details, affected code paths,
> exploit conditions, payloads, and remediation specifics until fixes are
> completed or responsibly disclosed.

## Status

- Branch: `AgentHits-Dev`
- Source revision scanned: `68d118a8f8ea25260ae327e8d4e9260b0d2c44c6`
- Scan date: 2026-06-23
- Scan mode: deep repository source scan
- Full internal report: `.agent-work/security/codex-security-deep-scan-2026-06-23-full.md`
- GitHub-safe report: `docs/security/codex-security-deep-scan-2026-06-23-github-report.md`
- Publication status: redacted for public GitHub storage

## Remediation Snapshot

| Finding | Public status | Evidence |
| --- | --- | --- |
| F-02 | Remediated after scan | Commit `5b73383` secured database password-change command construction and validation with focused regression tests. |
| F-01 | Remediated after scan | Commit `5b1a91d4f` secured the container metrics target and token boundary with focused regression tests. |
| F-04 | Remediated after scan | Commit `530393895` secured registry credential test command construction and access checks. |
| F-05 | Remediated after scan | Commit `48a5b8572` secured build and compose command construction boundaries with focused regression tests. |
| F-06 | Remediated after scan | Commit `25d6648b9` secured remote Traefik config writes with focused regression tests. |
| F-07 | Remediated after scan | Commit `154cca676` secured backup destination rclone command boundaries across backup listing, upload, restore, volume backup, and retention paths with focused regression tests. |
| F-08 | Remediated after scan | Commit `e68bf5f07` secured Git provider clone command boundaries across custom Git, GitHub, GitLab, Bitbucket, and Gitea clone paths with focused regression tests. |
| F-09 | Remediated after scan | Commit `c3333c886` constrained bind mount host paths to service-owned Dokploy directories at create/update time and before Docker mount generation, with focused regression tests for unsafe paths, persisted rows, compose context, exact service roots, and symlink escapes. |
| F-10 | Remediated after scan | Commit `bfca7226b` split read-only Docker/server access from privileged Docker lifecycle, inspect, exec, file upload, removal, and server terminal permissions with focused regression tests. |
| F-11 | Remediated after scan | Commit `35cca57dd` secured Docker image pull command boundaries for application Docker provider and remote database deploy pull paths with focused regression tests. |
| F-12 | Remediated after scan | Commit `9d15d5a3b` secured backup destination ownership checks before backup and volume-backup create/update persistence and scheduler side effects with focused regression tests. |
| F-13 | Remediated after scan | Commit `8b8f84325` secured GitHub App setup state handling with signed, expiring, session-bound state, authenticated callback checks, provider ownership checks, and focused regression tests. |
| F-03 | Remediated after scan | Commits `9debcd67c` and `62ddd8c7c` added assigned-server access checks for cluster, docker, server, deployment, backup, volume backup, domain, schedule, destination, and certificate routes with focused regression tests. |
| F-14 | Remediated after scan | Commits `3f9c68cad` and `87cce3235` secured target project/environment/server/service placement checks, project/environment ownership-field mass-assignment boundaries, project duplicate selected-service authorization, and volume-backup service binding reassignment checks with focused regression tests. |
| F-15 | Remediated after scan | Commit `1f1f1b676` restricted request-log reads and logging controls to the admin settings boundary, aligned Requests navigation/page gating, and added focused regression tests. |
| F-16 | Remediated after scan | Commit `6ef8254ad` added DNS-resolution guards for configurable outbound AI, notification, and Git provider targets with focused deterministic lookup regression tests. |

## Why This Is Redacted

The upstream project security policy asks researchers not to make vulnerabilities
public before they are investigated and addressed. This repository is public, so
the detailed internal report is kept outside Git-tracked files.

## Internal Backlog Summary

The internal report produced a remediation backlog covering authenticated control
plane boundaries, privileged Docker/SSH/shell execution, outbound request
handling, tenant/resource authorization, and deployment-host exposure controls.

Current handling model:

1. Re-validate each internal finding against the current `AgentHits-Dev` source.
2. Fix only findings that are still reachable in the current code.
3. Add focused regression tests or another repeatable validation artifact.
4. Run targeted checks plus broader project checks appropriate to the touched
   surface.
5. Commit each remediation as a narrow Conventional Commit with a body covering
   `Что`, `Зачем`, `Проверки`, and `Риски`.
6. Push only verified fixes and public-safe tracking documents.

## Verification Notes

The internal scan was static and intentionally did not run destructive exploit
payloads, mutate production/VPS infrastructure, or perform live Docker/SSH
attacks. Runtime verification was handled per remediation slice. After the final
recorded remediation set, the local Dokploy Vitest suite excluding the real
deploy file passed on 2026-06-23 (`94 files / 820 tests`). Remaining confidence
gaps are live VPS/production deploy smoke, exhaustive browser role-matrix smoke,
and a fresh independent deep source scan after remediation.

## Disclosure Notes

Do not copy the full internal report into a public issue, PR description,
comment, gist, or repository file until the relevant items are fixed or cleared
for responsible disclosure.
