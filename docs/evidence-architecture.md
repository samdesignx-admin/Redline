# UXNest Evidence Architecture

## Purpose

Visual evidence is a separate evidence layer. The audit may only score or explain what can be supported by trustworthy evidence; an audit-environment block is not a website UX failure.

## Canonical target

Every visual annotation should normalize to one target-centered object:

```text
EvidenceTarget
├── id
├── findingId
├── findingIndex
├── screenshotId
├── pageUrl
├── x
├── y
├── radius
├── target
├── explanation
├── confidence
└── status
```

Coordinates are percentages of the full source screenshot. `x` and `y` are the center of the exact visible UI target. `radius` is intentionally small and is clamped to 1.5–4.5%.

## Evidence status

- `observed` — directly supported by trustworthy evidence.
- `inferred` — reasonable interpretation, but not directly visible enough to treat as observed.
- `unverified` — the claim cannot currently be verified.
- `visual-only` — supported by a validated screenshot, without sufficient text/DOM evidence.
- `blocked` — the audit environment was blocked; this is not a website UX finding.
- `insufficient` — there is not enough trustworthy evidence to support the claim or score.

Only `observed` and `visual-only` evidence can support UX scoring. `blocked`, `insufficient`, and `unverified` evidence must not silently become scored findings.

## Renderer contract

Renderers must consume the canonical target rather than interpreting legacy `x/y/w/h` rectangles independently. The visual marker is a small numbered pin/ring centered on the canonical `x/y` target.

The same screenshot URL and target coordinates should be used by the in-app report, deck viewer, and PDF export. A renderer must not substitute a broad card, section, image, or whitespace region for the target.

## Validation rules

Before an evidence target is rendered:

1. The finding reference must resolve to a real finding.
2. The screenshot must exist and be an image asset.
3. The screenshot should correspond to the tested page URL when page metadata is available.
4. Coordinates must be finite and clamped to the screenshot bounds.
5. Radius must remain small and bounded.
6. A target explanation is required.
7. Duplicate targets should be removed.
8. No more than six evidence targets should be rendered for one audit pass.
9. Ambiguous targets should be omitted rather than guessed.

## Compatibility

The model accepts the existing pinpoint fields (`targetX`, `targetY`, `targetRadius`) and legacy focal fields (`cx`, `cy`, `radius`) while normalizing them to the canonical shape. Legacy rectangles are intentionally reduced to a small center pin instead of preserving a large box.
