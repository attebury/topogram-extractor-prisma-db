const manifest = require("./topogram-extractor.json");

const prismaExtractor = {
  id: "db.prisma-package",
  track: "db",
  detect() {
    return { score: 0, reasons: [] };
  },
  extract() {
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
};

module.exports = {
  manifest,
  extractors: [prismaExtractor]
};

