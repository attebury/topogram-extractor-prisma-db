const manifest = require("./topogram-extractor.json");
const fs = require("node:fs");
const path = require("node:path");

const prismaExtractor = {
  id: "db.prisma-package",
  track: "db",
  detect(context = {}) {
    const schemaFiles = findPrimaryFiles(context, (filePath) => filePath.endsWith(path.join("prisma", "schema.prisma")));
    if (schemaFiles.length === 0) return { score: 0, reasons: [] };
    const migrationDirs = findPrismaMigrationDirs(context, schemaFiles[0]);
    return {
      score: migrationDirs.length > 0 ? 100 : 70,
      reasons: migrationDirs.length > 0
        ? ["Found prisma/schema.prisma and Prisma migrations."]
        : ["Found prisma/schema.prisma."]
    };
  },
  extract(context = {}) {
    const schemaFiles = findPrimaryFiles(context, (filePath) => filePath.endsWith(path.join("prisma", "schema.prisma")));
    if (schemaFiles.length === 0) {
      return {
        findings: [],
        candidates: {
          entities: [],
          enums: [],
          relations: [],
          indexes: [],
          maintained_seams: []
        },
        diagnostics: []
      };
    }

    const schemaFile = schemaFiles[0];
    const schemaText = readText(schemaFile) || "";
    const parsed = parsePrismaSchema(schemaText);
    const migrationsPath = findPrismaMigrationPath(context, schemaFile);
    const maintainedSeam = buildMaintainedDbSeam(context, {
      schemaFile,
      migrationsPath,
      migrationEvidence: migrationsPath ? listFilesRecursive(path.resolve(rootDir(context), migrationsPath), (filePath) => filePath.endsWith(".sql")) : []
    });

    return {
      findings: [],
      candidates: {
        entities: parsed.entities,
        enums: parsed.enums,
        relations: parsed.relations,
        indexes: parsed.indexes,
        maintained_seams: maintainedSeam ? [maintainedSeam] : []
      },
      diagnostics: []
    };
  }
};

module.exports = {
  manifest,
  extractors: [prismaExtractor]
};

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "app",
  "dist",
  "build",
  "coverage",
  ".tmp",
  ".topogram"
]);

function rootDir(context) {
  return path.resolve(context?.paths?.inputRoot || context?.paths?.workspaceRoot || process.cwd());
}

function repoRoot(context) {
  return path.resolve(context?.paths?.repoRoot || rootDir(context));
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function listFilesRecursive(dirPath, predicate, result = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) listFilesRecursive(absolutePath, predicate, result);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!predicate || predicate(absolutePath)) result.push(absolutePath);
  }
  return result;
}

function findPrimaryFiles(context, predicate) {
  return listFilesRecursive(rootDir(context), (filePath) => {
    if (!isPrimarySource(context, filePath)) return false;
    return predicate(filePath);
  }).sort();
}

function isPrimarySource(context, filePath) {
  const relativePath = normalizeRelative(rootDir(context), filePath);
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.some((segment) => IGNORED_DIRS.has(segment))) return false;
  if (segments.includes("__fixtures__") || segments.includes("__tests__") || segments.includes("fixtures") || segments.includes("tests")) return false;
  if (segments[0] === "docs" || segments[0] === "examples") return false;
  if (segments.some((segment) => /^(fixtures?|test-fixtures|snapshots?|generated)$/i.test(segment))) return false;
  return true;
}

function normalizeRelative(basePath, filePath) {
  return path.relative(basePath, filePath).split(path.sep).join("/");
}

function parsePrismaSchema(schemaText) {
  const entities = [];
  const enums = [];
  const relations = [];
  const indexes = [];
  const modelNames = new Set();

  for (const modelMatch of schemaText.matchAll(/\bmodel\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g)) {
    modelNames.add(modelMatch[1]);
  }

  for (const enumMatch of schemaText.matchAll(/\benum\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g)) {
    const enumName = enumMatch[1];
    const values = enumMatch[2]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"))
      .map((line) => line.split(/\s+/)[0])
      .filter(Boolean);
    enums.push(candidateRecord({
      id_hint: idHintify(enumName),
      name: enumName,
      values,
      evidence: [`prisma enum ${enumName}`],
      confidence: 0.9
    }));
  }

  for (const modelMatch of schemaText.matchAll(/\bmodel\s+([A-Za-z][A-Za-z0-9_]*)\s*\{([\s\S]*?)\n\}/g)) {
    const modelName = modelMatch[1];
    const body = modelMatch[2];
    const fields = [];
    const modelId = `entity_${idHintify(modelName)}`;
    const modelFieldMap = new Map();

    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const fieldMatch = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(\??|\[\])?\s*(.*)$/);
      if (!fieldMatch) continue;
      const fieldName = fieldMatch[1];
      const typeName = fieldMatch[2];
      const modifier = fieldMatch[3] || "";
      const attributes = fieldMatch[4] || "";
      modelFieldMap.set(fieldName, { typeName, attributes });
      if (modelNames.has(typeName) && attributes.includes("@relation")) continue;
      if (modifier === "[]") continue;
      fields.push({
        name: fieldName,
        type: mapPrismaType(typeName),
        required: modifier !== "?",
        unique: attributes.includes("@unique"),
        primary: attributes.includes("@id"),
        evidence: [`field ${modelName}.${fieldName}`]
      });
      if (attributes.includes("@unique")) {
        indexes.push(candidateRecord({
          id_hint: `index_${idHintify(modelName)}_${idHintify(fieldName)}_unique`,
          entity: modelId,
          fields: [fieldName],
          unique: true,
          evidence: [`@unique ${modelName}.${fieldName}`],
          confidence: 0.85
        }));
      }
    }

    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//")) continue;
      const relationMatch = line.match(/^([A-Za-z][A-Za-z0-9_]*)\s+([A-Za-z][A-Za-z0-9_]*)(\??|\[\])?\s+.*@relation\(([^)]*)\)/);
      if (!relationMatch) continue;
      const relatedModel = relationMatch[2];
      const relationArgs = relationMatch[4];
      const fieldsArg = relationArgs.match(/\bfields\s*:\s*\[([^\]]+)\]/);
      const referencesArg = relationArgs.match(/\breferences\s*:\s*\[([^\]]+)\]/);
      relations.push(candidateRecord({
        id_hint: `rel_${idHintify(modelName)}_${idHintify(relatedModel)}`,
        from: modelId,
        to: `entity_${idHintify(relatedModel)}`,
        fields: fieldsArg ? splitPrismaList(fieldsArg[1]) : [],
        references: referencesArg ? splitPrismaList(referencesArg[1]) : [],
        evidence: [`@relation ${modelName}.${relationMatch[1]}`],
        confidence: 0.85
      }));
    }

    for (const indexMatch of body.matchAll(/@@(index|unique)\s*\(\s*\[([^\]]+)\]/g)) {
      const unique = indexMatch[1] === "unique";
      const fieldNames = splitPrismaList(indexMatch[2]);
      indexes.push(candidateRecord({
        id_hint: `index_${idHintify(modelName)}_${fieldNames.map(idHintify).join("_")}${unique ? "_unique" : ""}`,
        entity: modelId,
        fields: fieldNames,
        unique,
        evidence: [`@@${indexMatch[1]} ${modelName}(${fieldNames.join(", ")})`],
        confidence: 0.85
      }));
    }

    entities.push(candidateRecord({
      id_hint: modelId,
      name: modelName,
      source: "prisma",
      fields,
      evidence: [`prisma model ${modelName}`],
      confidence: 0.9
    }));
  }

  return {
    entities: dedupe(entities, (entry) => entry.id_hint),
    enums: dedupe(enums, (entry) => entry.id_hint),
    relations: dedupe(relations, (entry) => entry.id_hint),
    indexes: dedupe(indexes, (entry) => entry.id_hint)
  };
}

function splitPrismaList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function mapPrismaType(typeName) {
  const lowered = typeName.toLowerCase();
  if (lowered === "string" || lowered === "uuid") return "string";
  if (lowered === "int" || lowered === "bigint" || lowered === "float" || lowered === "decimal") return "number";
  if (lowered === "boolean") return "boolean";
  if (lowered === "datetime") return "datetime";
  if (lowered === "json") return "json";
  return "string";
}

function findPrismaMigrationDirs(context, schemaFile) {
  const migrationsPath = findPrismaMigrationPath(context, schemaFile);
  if (!migrationsPath) return [];
  const absolutePath = path.resolve(rootDir(context), migrationsPath);
  try {
    return fs.readdirSync(absolutePath, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(absolutePath, entry.name));
  } catch {
    return [];
  }
}

function findPrismaMigrationPath(context, schemaFile) {
  const schemaDir = path.dirname(schemaFile);
  const conventional = path.join(schemaDir, "migrations");
  if (hasSqlFiles(conventional)) return normalizeRelative(rootDir(context), conventional);
  const rootConventional = path.join(rootDir(context), "prisma", "migrations");
  if (hasSqlFiles(rootConventional)) return normalizeRelative(rootDir(context), rootConventional);
  return "";
}

function hasSqlFiles(dirPath) {
  return listFilesRecursive(dirPath, (filePath) => filePath.endsWith(".sql")).length > 0;
}

function buildMaintainedDbSeam(context, options) {
  const schemaPath = normalizeRelative(rootDir(context), options.schemaFile);
  const migrationsPath = options.migrationsPath || "";
  const evidence = [
    candidateEvidence(context, options.schemaFile, "Prisma schema file"),
    ...options.migrationEvidence.slice(0, 5).map((filePath) => candidateEvidence(context, filePath, "Prisma migration SQL"))
  ].filter(Boolean);
  return candidateRecord({
    kind: "maintained_db_migration_seam",
    id_hint: "seam_prisma_db_migrations",
    tool: "prisma",
    ownership: "maintained",
    apply: "never",
    schemaPath,
    migrationsPath,
    snapshotPath: "topo/state/db/app_db/current.snapshot.json",
    runtime_id_hint: "app_db",
    projection_id_hint: "proj_db",
    confidence: migrationsPath ? 0.9 : 0.55,
    evidence,
    match_reasons: migrationsPath
      ? ["Found prisma/schema.prisma and Prisma migrations."]
      : ["Found prisma/schema.prisma without a migrations directory."],
    missing_decisions: migrationsPath
      ? []
      : ["Confirm the maintained migration directory before configuring a DB seam."],
    proposed_runtime_migration: {
      kind: "database",
      id: "app_db",
      ownership: "maintained",
      migration: {
        tool: "prisma",
        schemaPath,
        migrationsPath,
        snapshotPath: "topo/state/db/app_db/current.snapshot.json",
        apply: "manual"
      }
    },
    manual_next_steps: [
      "Review the Prisma schema and migrations.",
      "Copy the proposed runtime migration into topogram.project.json only after review.",
      "Keep import review-only; do not let extraction apply migrations."
    ],
    project_config_target: "topogram.project.json topology.runtimes[]",
    maintained_modules: [schemaPath, migrationsPath].filter(Boolean),
    emitted_dependencies: ["topo/state/db/app_db/current.snapshot.json"],
    allowed_change_classes: ["migration_plan", "sql_proposal", "schema_snapshot"],
    drift_signals: ["schema_changed", "migration_directory_changed"]
  });
}

function candidateEvidence(context, filePath, note) {
  return {
    file: normalizeRelative(repoRoot(context), filePath),
    appPath: normalizeRelative(rootDir(context), filePath),
    note
  };
}

function candidateRecord(fields) {
  return {
    source: "package:@topogram/extractor-prisma-db",
    ...fields
  };
}

function idHintify(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function dedupe(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
