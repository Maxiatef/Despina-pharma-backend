/**
 * Seeds reference data. Safe to run many times (upserts on slug/code).
 *   npm run seed
 *
 * - 14 categories, 7 manufacturer sources and 972 catalog items from catalog-data.json
 * - the 16 service pages of the current website
 * - the default project stage template
 * - the first admin user (ADMIN_EMAIL / ADMIN_PASSWORD), only if no admin exists yet
 */
import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import dataSource from './data-source.js';
import { CatalogCategory, CatalogItem, CatalogSource, Service, StageTemplate, User } from './entities/index.js';
import { CATALOG_ITEM_KINDS } from '../common/enums.js';
import type { CatalogItemKind } from '../common/enums.js';
import { DEFAULT_STAGES } from '../modules/projects/projects.service.js';

interface RawSource { id: string; name: string; url?: string; label?: string; notes?: string; ingredients?: string[] }
interface RawProduct { name: string; slug: string; kind: string; subgroup?: string; sources?: RawSource[] }
interface RawCatalog {
  categories: { slug: string; title: string; products: RawProduct[] }[];
  sources: { id: string; name: string; website?: string }[];
}

/** Service pages on the current site (slug → title). */
const SERVICES: [string, string][] = [
  ['custom-formulation', 'Custom formulation & R&D'],
  ['semi-custom-development', 'Semi-custom development'],
  ['private-label', 'Private-label starting points'],
  ['bulk-manufacturing', 'Bulk manufacturing & scale-up'],
  ['contract-filling', 'Contract filling'],
  ['packaging', 'Packaging'],
  ['branding-design', 'Branding & design'],
  ['ingredient-sourcing', 'Ingredient & component sourcing'],
  ['quality-control', 'Quality control & testing'],
  ['regulatory-documentation', 'Product documentation planning'],
  ['specialty-development', 'Specialty product review'],
  ['fulfillment', 'Fulfillment & dispatch'],
  ['amazon-fba', 'Amazon FBA preparation'],
  ['subscription-box', 'Subscription box programs'],
  ['celebrities-influencers', 'Creator & founder brands'],
  ['brand-launch-support', 'Brand launch planning'],
];

async function main() {
  await dataSource.initialize();
  const path = resolve(process.env.CATALOG_DATA_PATH ?? '../Despina-Pharma-IT-Package/project/catalog-data.json');
  const data = JSON.parse(await readFile(path, 'utf8')) as RawCatalog;

  await dataSource.transaction(async (m) => {
    // ---- sources ----
    const srcRepo = m.getRepository(CatalogSource);
    await srcRepo.upsert(data.sources.map((s) => ({ code: s.id, name: s.name, website: s.website ?? null })), ['code']);
    const sources = new Map((await srcRepo.find()).map((s) => [s.code, s.id]));

    // ---- categories + items ----
    const catRepo = m.getRepository(CatalogCategory);
    const itemRepo = m.getRepository(CatalogItem);
    let itemCount = 0;
    for (const [i, c] of data.categories.entries()) {
      await catRepo.upsert({ slug: c.slug, title: c.title, sortOrder: i, isPublished: true }, ['slug']);
      const cat = await catRepo.findOneByOrFail({ slug: c.slug });
      const rows = c.products.map((p) => {
        const first = p.sources?.[0];
        return {
          categoryId: cat.id,
          sourceId: first ? (sources.get(first.id) ?? null) : null,
          slug: p.slug,
          name: p.name,
          kind: ((CATALOG_ITEM_KINDS as readonly string[]).includes(p.kind) ? p.kind : 'stock-reference') as CatalogItemKind,
          subgroup: p.subgroup ?? null,
          ingredients: first?.ingredients ?? [],
          sources: (p.sources ?? []).map((s) => ({ code: s.id, name: s.name, url: s.url ?? null, label: s.label ?? null, notes: s.notes ?? null })),
          notes: first?.notes ?? null,
          isPublished: true,
        };
      });
      for (let k = 0; k < rows.length; k += 200) {
        await itemRepo.upsert(rows.slice(k, k + 200), ['categoryId', 'slug']);
      }
      itemCount += rows.length;
    }
    console.log(`Catalog: ${data.categories.length} categories, ${sources.size} sources, ${itemCount} items`);

    // ---- services ----
    await m.getRepository(Service).upsert(
      SERVICES.map(([slug, title], i) => ({ slug, title, sortOrder: i, isPublished: true })),
      ['slug'],
    );
    console.log(`Services: ${SERVICES.length}`);

    // ---- default stage template ----
    const tplRepo = m.getRepository(StageTemplate);
    if (!(await tplRepo.findOneBy({ isDefault: true }))) {
      await tplRepo.upsert({ name: 'Standard development', stages: DEFAULT_STAGES, isDefault: true }, ['name']);
      console.log('Stage template: Standard development (default)');
    }

    // ---- first admin ----
    const users = m.getRepository(User);
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!(await users.findOneBy({ role: 'admin' }))) {
      if (email && password && password.length >= 10) {
        await users.insert({ email: email.toLowerCase(), role: 'admin', passwordHash: await bcrypt.hash(password, 12), isActive: true });
        console.log(`Admin user created: ${email}`);
      } else {
        console.log('No admin yet: set ADMIN_EMAIL and ADMIN_PASSWORD (10+ chars) in .env and run the seed again.');
      }
    }
  });

  await dataSource.destroy();
}

main().catch(async (err) => {
  console.error(err);
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
