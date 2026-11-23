import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FoodSource } from '../../src/common/constants';
import { loadSeedData, SeedData } from './seed-data';
import {
  loadSeedTranslations,
  SeedTranslations,
  validateSeedTranslations,
} from './seed-translations';

describe('seed translations', () => {
  const data = {
    foods: [{ slug: 'rice', name: 'Rice' }],
    importedFoods: [{ name: 'Salt', source: FoodSource.UsdaFdc, sourceId: '42' }],
    recipes: [
      {
        slug: 'rice-bowl',
        name: 'Rice bowl',
        instructions: 'Boil.',
        ingredients: [
          { food: 'rice', quantityG: 100, notes: 'rinsed' },
          { food: 'usda_fdc:42', quantityG: 1 },
        ],
      },
    ],
    foodCategories: [],
  } as unknown as SeedData;

  const complete: SeedTranslations = {
    locale: 'uk',
    foods: { rice: 'Рис', 'usda_fdc:42': 'Сіль' },
    recipes: { 'rice-bowl': { name: 'Миска рису', description: null, instructions: 'Зваріть.' } },
    notes: { rinsed: 'промитий' },
  };

  describe('validateSeedTranslations', () => {
    it('accepts a complete translation', () => {
      expect(validateSeedTranslations([complete], data)).toEqual({ errors: [], warnings: [] });
    });

    it('rejects an unknown or repeated locale, unknown keys and empty text', () => {
      const { errors } = validateSeedTranslations(
        [
          {
            locale: 'xx',
            foods: { rice: ' ', bread: 'Хліб' },
            recipes: { soup: { name: '', description: null, instructions: '' } },
            notes: { rinsed: '' },
          },
          { ...complete, locale: 'xx' },
        ],
        data,
      );

      expect(errors).toEqual(
        expect.arrayContaining([
          'translations "xx": unknown locale',
          'translations "xx": duplicate locale',
          'translations "xx": food "rice" has an empty name',
          'translations "xx": food "bread" is not in the seed foods',
          'translations "xx": recipe "soup" is not in the seed recipes',
          'translations "xx": recipe "soup" has an empty name',
          'translations "xx": recipe "soup" has empty instructions',
          'translations "xx": note "rinsed" has an empty translation',
        ]),
      );
    });

    it('warns about untranslated rows and unused notes', () => {
      const { errors, warnings } = validateSeedTranslations(
        [{ locale: 'uk', foods: { rice: 'Рис' }, recipes: {}, notes: { boiled: 'варений' } }],
        data,
      );

      expect(errors).toEqual([]);
      expect(warnings).toEqual([
        'translations "uk": note "boiled" is not used by any recipe',
        'translations "uk": 1 foods untranslated: usda_fdc:42',
        'translations "uk": 1 recipes untranslated: rice-bowl',
        'translations "uk": 1 notes untranslated: rinsed',
      ]);
    });
  });

  describe('loadSeedTranslations', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'translations-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('reads every json file of the directory, missing sections as empty', () => {
      writeFileSync(join(dir, 'uk.json'), JSON.stringify({ locale: 'uk', foods: { rice: 'Рис' } }));
      writeFileSync(join(dir, 'README.md'), 'not a translation');

      expect(loadSeedTranslations(dir)).toEqual([
        { locale: 'uk', foods: { rice: 'Рис' }, recipes: {}, notes: {} },
      ]);
    });

    it('returns none for a missing directory', () => {
      expect(loadSeedTranslations(join(dir, 'missing'))).toEqual([]);
    });
  });

  it('the committed translations are valid and complete', () => {
    expect(validateSeedTranslations(loadSeedTranslations(), loadSeedData())).toEqual({
      errors: [],
      warnings: [],
    });
  });
});
