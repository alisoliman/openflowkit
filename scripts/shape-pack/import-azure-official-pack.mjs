import fs from 'node:fs/promises';
import path from 'node:path';

// These unqualified paths are already stored in diagrams created with V20.
const PRIMARY_SOURCE_IDS = {
  'compute/workspaces': '00400',
  'networking/load-balancer-hub': '02302',
};
const LABEL_OVERRIDES = {
  'ai-foundry': 'Microsoft Foundry',
  promethus: 'Prometheus',
  pubsub: 'Azure PubSub',
  vpnclientwindows: 'Azure VPN Client for Windows',
};
const CATEGORY_LABELS = {
  'ai-plus-machine-learning': 'AI + Machine Learning',
  devops: 'DevOps',
  iot: 'IoT',
};

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/^azure-public-service-icons$/g, '')
    .replace(/^icons$/g, '')
    .replace(/^\d+\s*-icon-service-/g, '')
    .replace(/-icon-service-/g, '-')
    .replace(/\(classic\)/g, 'classic')
    .replace(/\(deprecated\)/g, 'deprecated')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function getLabel(sourceStem) {
  const name = sourceStem.replace(/^\d+\s*-icon-service-/i, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return LABEL_OVERRIDES[slugify(sourceStem)] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

function getCategoryLabel(category) {
  return CATEGORY_LABELS[slugify(category)]
    ?? category.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

async function walk(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

const [, , sourceRootArg, outputRootArg] = process.argv;

if (!sourceRootArg || !outputRootArg) {
  console.error('Usage: node scripts/shape-pack/import-azure-official-pack.mjs <sourceRoot> <outputRoot>');
  process.exit(1);
}

const sourceRoot = path.resolve(sourceRootArg);
const outputRoot = path.resolve(outputRootArg);
const svgFiles = (await walk(sourceRoot)).filter((filePath) => filePath.toLowerCase().endsWith('.svg'));
if (svgFiles.length === 0) {
  throw new Error(`No Azure SVGs found in ${sourceRoot}`);
}

const catalogPath = path.join(outputRoot, 'catalog.json');
let catalog = { categories: {}, labels: {} };
try {
  catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}

const groups = new Map();
for (const filePath of svgFiles) {
  const relativePath = path.relative(sourceRoot, filePath);
  const segments = relativePath.split(path.sep);

  if (segments.length !== 2) {
    throw new Error(`Expected category/name.svg, got ${relativePath}. Use the archive's Icons directory as sourceRoot.`);
  }

  const categorySegment = slugify(segments[0]);
  const sourceStem = path.basename(filePath).replace(/\.svg$/i, '');
  const fileStem = slugify(sourceStem);
  if (!categorySegment || !fileStem) {
    throw new Error(`Cannot derive an Azure icon id from ${relativePath}`);
  }

  const key = `${categorySegment}/${fileStem}`;
  const group = groups.get(key) ?? [];
  group.push({ filePath, sourceStem, sourceId: sourceStem.match(/^\d+/)?.[0] });
  groups.set(key, group);
  catalog.categories[categorySegment] = getCategoryLabel(segments[0]);
}

const imports = new Map();
for (const [key, group] of groups) {
  const primary = group.find((source) => source.sourceId === PRIMARY_SOURCE_IDS[key]) ?? group[0];
  for (const source of group) {
    if (source !== primary && !source.sourceId) {
      throw new Error(`Cannot disambiguate duplicate Azure icon ${source.filePath}`);
    }
    const outputId = source === primary ? key : `${key}-${source.sourceId}`;
    if (imports.has(outputId)) {
      throw new Error(`Duplicate Azure output path: ${outputId}`);
    }
    imports.set(outputId, source.filePath);
    catalog.labels[outputId.replaceAll('/', '-')] = getLabel(source.sourceStem);
  }
}

await fs.mkdir(outputRoot, { recursive: true });
for (const filePath of (await walk(outputRoot)).filter((file) => file.endsWith('.svg'))) {
  const id = path.relative(outputRoot, filePath).replaceAll(path.sep, '-').replace(/\.svg$/, '');
  if (!catalog.labels[id]) {
    throw new Error(`Missing label for retained Azure icon ${id}. Import older source archives first.`);
  }
}

for (const [outputId, sourcePath] of imports) {
  const outputPath = path.join(outputRoot, `${outputId}.svg`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.copyFile(sourcePath, outputPath);
}

catalog = {
  categories: Object.fromEntries(Object.entries(catalog.categories).sort(([left], [right]) => left.localeCompare(right))),
  labels: Object.fromEntries(Object.entries(catalog.labels).sort(([left], [right]) => left.localeCompare(right))),
};
await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Imported ${imports.size} Azure SVGs into ${outputRoot}; ${Object.keys(catalog.labels).length} labeled icons including retained versions.`);
