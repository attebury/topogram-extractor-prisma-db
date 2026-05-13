# @topogram/extractor-prisma-db

Package-backed Topogram extractor for Prisma database schemas and migrations.

This repository currently contains the extractor package skeleton. The next implementation pass will add precision-first extraction for `prisma/schema.prisma`, Prisma migrations, and maintained database seam candidates.

Extractor packages run only during `topogram extract`, emit review-only candidates, and never mutate the source app or write canonical `topo/**` directly.

## Verification

```bash
npm run check
```

