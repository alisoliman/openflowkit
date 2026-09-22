# Azure Icons Source Metadata

- Provider: Microsoft Azure
- Source page and terms: https://learn.microsoft.com/en-us/azure/architecture/icons/
- Current release: V24, July 2026 (source page updated 2026-07-09)
- Official download: https://arch-center.azureedge.net/icons/Azure_Public_Service_Icons_V24.zip
- Archive: `raw/Azure_Public_Service_Icons_V24.zip`
- Archive SHA-256: `921594ccd1bf3d9c0a1bd7b6d924e050551a59342f2b353bb74bdcf761c35141`
- Last verified: 2026-09-22
- Status: Imported and labeled for architecture diagram use

## Permitted use

Microsoft permits copying, distributing, and displaying these icons in architectural
diagrams, training materials, or documentation. Microsoft reserves all other rights.
Do not crop, flip, rotate, distort, or change the icons, or use Microsoft product
icons to represent OpenFlowKit or another product. Keep the product name close to
the icon in diagrams.

The processed SVGs are byte-for-byte copies of the official artwork, not redrawn or
tightened variants. The original download, including Microsoft's FAQ, is retained.

## Coverage and compatibility

- All 714 SVGs in V24 are included, plus 22 older paths retained for saved diagrams.
- The 736 bundled icons have product labels and category names in `processed/catalog.json`.
  This small text index is shared by the app catalog, automatic icon matching, and
  the MCP manifest generator. SVG URLs remain lazily loaded.
- `azure-official-icons-v20` is a persisted pack identifier, not the release version.
  Keep it stable so existing diagrams and templates continue resolving their icons.
- The two distinct Workspaces icons and two Load Balancer Hub icons are preserved.
  Their established unsuffixed paths retain source IDs `00400` and `02302`;
  the additional variants use `workspaces-00330.svg` and
  `load-balancer-hub-029029174.svg`.
- Labels preserve source capitalization (AI, API, SQL, IoT, DDoS, and DocumentDB).
  The importer also expands `VPNClientWindows`, corrects `promethus`, and uses the
  source page's product names Microsoft Foundry and Azure PubSub.

## Refreshing the pack

Download the archive linked from the source page, verify its terms, and keep it in
`raw/`. Extract it outside the repository, then run:

```sh
node scripts/shape-pack/import-azure-official-pack.mjs \
  /path/to/extracted/Azure_Public_Service_Icons/Icons \
  assets/third-party-icons/azure/processed
npm run build:icons --workspace=mcp-server
npm run test -- --run src/services/shapeLibrary/azureCatalog.test.ts src/services/shapeLibrary/providerCatalog.test.ts
```

The importer merges labels and retains older assets rather than deleting paths.
When rebuilding the catalog from scratch, import the retained V20 archive first,
then V24. Update the archive checksum, coverage assertions, and release metadata
when adopting a newer official release.
