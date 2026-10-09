## Code style
- Don't write comments that restate what the code already says.
- Comment only the "why" when something isn't obvious: workarounds,
  counterintuitive decisions, constraints from an external API.
- No section-divider comments like `// --- Helpers ---`.
- Don't leave comments describing the change you just made.

## Ports and certificates

Порт 80 на серверах не открываем никогда. Сертификаты обновляются только через порт 443 (tlsChallenge). Не добавлять httpChallenge и публикацию порта 80 ни в код, ни в установщик.

## Pull requests

Every pull request targets `AgentHits-Dev`, including a PR that builds on another open PR. Checks run only for that base, so a PR stacked on another branch gets none. When one PR depends on another, say so in the description; do not change the base.
