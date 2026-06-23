# GitHub-Safe Security Scan Report: AgentHits-Dev

This is a GitHub-safe projection of an internal Codex Security deep scan report.
It preserves the management summary, remediation queue, and verification status,
while redacting exploit-level evidence, affected line ranges, code snippets, and
payload guidance.

## Scan Metadata

| Field | Value |
| --- | --- |
| Project | Dokploy fork / `AgentHits-Dev` |
| Scan date | 2026-06-23 |
| Scan mode | Deep repository source scan |
| Scanned revision | `68d118a8f8ea25260ae327e8d4e9260b0d2c44c6` |
| Reportable findings | 16 |
| Severity mix | 11 high, 5 medium |
| Confidence mix | 9 high, 7 medium |
| Coverage | Partial static source coverage |
| Public status | Redacted for GitHub storage |
| Raw report SHA-256 | `44c713f17772807177772b419e1c059547ffb557f645122c968a8c1cddf33641` |

## Disclosure Boundary

The full internal report includes source-to-sink evidence and remediation detail
for active security issues. Those details should not be copied into a public
GitHub issue, pull request, gist, comment, or repository file until each item is
fixed or cleared for responsible disclosure.

The private raw report is intentionally kept outside tracked source files:

```text
.agent-work/security/codex-security-deep-scan-2026-06-23-full.md
```

The private raw report was restored locally from the sealed `report.md`
projection and rechecked against the user-supplied `report.md` attachment on
2026-06-23. It remains excluded from Git tracking.

## Executive Summary

The scan found a remediation backlog across authenticated control plane
boundaries, privileged Docker and shell execution, server assignment checks,
stored credential handling, deployment host exposure, backup integration, and
server-side outbound request controls.

The scan was static. It did not run destructive command injection payloads,
mutate production or VPS infrastructure, or perform live Docker, SSH, browser
role-matrix, or real deploy smoke tests.

## Redacted Finding Register

| ID | Severity | Confidence | Area | Current handling status |
| --- | --- | --- | --- | --- |
| F-01 | High | High | Monitoring outbound request boundary | Remediated after scan |
| F-02 | High | High | Database credential rotation command boundary | Remediated after scan |
| F-03 | High | High | Server assignment authorization boundary | Partially remediated after scan |
| F-04 | High | High | Registry credential test command boundary | Remediated after scan |
| F-05 | High | Medium | Build and compose command construction boundary | Remediated after scan |
| F-06 | High | Medium | Remote routing config write boundary | Remediated after scan |
| F-07 | High | High | Backup destination command boundary | Remediated after scan |
| F-08 | High | High | Git provider clone command boundary | Remediated after scan |
| F-09 | High | Medium | Host path mount exposure boundary | Remediated after scan |
| F-10 | High | High | Read permission privileged action boundary | Remediated after scan |
| F-11 | High | High | Docker image pull command boundary | Remediated after scan |
| F-12 | Medium | Medium | Backup destination ownership boundary | Remediated after scan |
| F-13 | Medium | Medium | GitHub App callback state boundary | Remediated after scan |
| F-14 | Medium | Medium | Placement and ownership assignment boundary | Remediated after scan |
| F-15 | Medium | High | Request log access and logging control boundary | Remediated after scan |
| F-16 | Medium | Medium | Outbound URL private address resolution boundary | Remediated after scan |

## Remediation Log

| Finding | Status | Evidence |
| --- | --- | --- |
| F-02 | Remediated after scan | Commit `5b73383` quotes password-change shell arguments, validates database identifiers, tightens new database password validation, and adds focused regression tests. |
| F-01 | Remediated after scan | Commit `5b1a91d4f` moved container metrics target and bearer-token resolution server-side, removed caller-supplied URL/token inputs, and added focused boundary tests. |
| F-04 | Remediated after scan | Commit `530393895` added server-access checks, safe registry login command construction, redacted registry test errors, and focused regression tests. |
| F-05 | Remediated after scan | Commit `48a5b8572` added argv-safe compose/dockerfile command construction, custom compose command rejection, env assignment validation, quoted env-file redirects, and focused regression tests. |
| F-06 | Remediated after scan | Commit `25d6648b9` moved remote Traefik YAML writes to encoded payload transport, quoted the destination path, and added focused regression tests. |
| F-07 | Remediated after scan | Commit `154cca676` added argv-safe rclone command construction for backup destinations, backup file listing, backup upload, restore, volume backup, and retention paths with focused regression tests. |
| F-08 | Remediated after scan | Commit `e68bf5f07` added argv-safe Git provider clone command construction for custom Git, GitHub, GitLab, Bitbucket, and Gitea clone paths with focused regression tests. |
| F-09 | Remediated after scan | Commit `c3333c886` constrained bind mount host paths to service-owned Dokploy directories at create/update time and before Docker mount generation, with focused regression tests for unsafe paths, persisted rows, compose context, exact service roots, and symlink escapes. |
| F-10 | Remediated after scan | Commit `bfca7226b` split Docker read-only access from container lifecycle, inspect, exec, file upload, and removal permissions, moved server terminals to an explicit execute permission, updated custom role controls, and added focused regression tests. |
| F-11 | Remediated after scan | Commit `35cca57dd` added argv-safe Docker image pull command construction for application Docker provider and remote database deploy pull paths with focused regression tests. |
| F-12 | Remediated after scan | Commit `9d15d5a3b` added destination ownership checks before backup and volume-backup create/update persistence and scheduler side effects with focused regression tests. |
| F-13 | Remediated after scan | Commit `8b8f84325` added signed, expiring, session-bound GitHub App setup state for provider creation and installation binding, enforced authenticated session and provider ownership checks before callback mutations, removed plaintext UI state generation, and added focused regression tests. |
| F-03 | Partially remediated after scan | Commit `9debcd67c` added assigned-server access checks for cluster and docker router operations plus focused regression tests. Other server-scoped surfaces still need revalidation. |
| F-14 | Remediated after scan | Commits `3f9c68cad` and `87cce3235` added target project/environment/server/service placement checks, narrowed project/environment update schemas and services to avoid ownership-field mass assignment, guarded project duplicate selected services before target project creation, guarded volume-backup service bindings before persistence, and added focused regression tests. |
| F-15 | Remediated after scan | Commit `1f1f1b676` moved request-log reads and request/log-cleanup controls behind the admin settings boundary, aligned Requests navigation/page access, and added focused authorization regression tests. |
| F-16 | Remediated after scan | Commit `6ef8254ad` added DNS-resolution guards for configurable AI provider, notification, and Git provider outbound targets with focused deterministic lookup regression tests. |
| Report tracking | Added | Commit `b072b017c` added a public-safe security remediation tracker. |

## Working Plan

1. Revalidate each internal finding against the current `AgentHits-Dev` source.
2. Fix only findings that are still reachable.
3. Add focused regression tests or another repeatable validation artifact.
4. Run targeted checks plus broader project checks for the touched surface.
5. Commit each remediation as a narrow Conventional Commit with a body covering
   `Что`, `Зачем`, `Проверки`, and `Риски`.
6. Keep the full raw report outside tracked files unless the repository is
   private and the security disclosure boundary is intentionally changed.

## Residual Verification Gaps

- No real VPS or Linux Docker deploy smoke was completed for the final scan tail.
- No browser role-matrix auth smoke was completed for every reported route.
- No destructive exploit payloads were executed against live Docker or SSH targets.
- Static source findings still require per-slice runtime or test validation while
  being remediated.

## Canonical Local Artifacts

The internal scan sealed the following canonical artifacts in the temporary scan
workspace:

- `scan-manifest.json`
- `findings.json`
- `coverage.json`
- `report.md`

Only this redacted projection and the tracker are intended for GitHub storage.
