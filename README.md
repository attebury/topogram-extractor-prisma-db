# @topogram/extractor-prisma-db

> Package-backed Topogram extractor for Prisma database schemas and migrations.

Status: current
Audience: extractor package authors and maintainers
Use when: you need to change extractor evidence recovery, manifests, package metadata, or release proof.

Package-backed Topogram extractor for Prisma database schemas and migrations.

This package extracts review-only database candidates from Prisma projects:

- `prisma/schema.prisma` models, enums, relations, and indexes
- Prisma migration directories
- maintained database seam candidates for manual `topogram.project.json` review

Extractor packages run only during `topogram extract`, emit review-only candidates, and never mutate the source app or write canonical `topo/**` directly.

## Usage

```bash
topogram extract ./brownfield-app --out ./topogram-review --from db --extractor @topogram/extractor-prisma-db
```

## Verification

```bash
npm run check
```

## Release Preflight

```bash
npm run release:preflight
```

The preflight runs package checks, docs/RAG verification, `npm pack --dry-run`,
and Gitleaks secret scanning before publish or broad sharing.
