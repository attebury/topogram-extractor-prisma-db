# @topogram/extractor-prisma-db

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
