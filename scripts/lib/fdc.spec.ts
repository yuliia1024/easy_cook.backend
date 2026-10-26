import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FoodState } from '../../src/common/constants';
import {
  buildFoodItems,
  detectFoodState,
  FDC_NUTRIENT,
  pickNutrients,
  readFdcExport,
  readFdcPortions,
} from './fdc';

const amounts = (entries: Array<[number, number]>): Map<number, number> => new Map(entries);

describe('USDA FDC import', () => {
  describe('detectFoodState', () => {
    it.each([
      ['Rice, white, long-grain, regular, raw, enriched', FoodState.Raw],
      ['Beans, black, mature seeds, cooked, boiled, without salt', FoodState.Boiled],
      ['Peanuts, all types, dry-roasted, with salt', FoodState.Roasted],
      ['Chicken, broilers or fryers, breast, meat only, cooked, fried', FoodState.Fried],
      ['Lentils, dry', FoodState.Dried],
      ['Beans, kidney, red, mature seeds, canned, drained solids', FoodState.Canned],
      ['Peas, green, frozen, unprepared', FoodState.Frozen],
      ['Fish, salmon, Atlantic, farmed, cooked', FoodState.Cooked],
      ['Hummus, commercial', FoodState.Other],
    ])('%s -> %s', (description, state) => {
      expect(detectFoodState(description)).toBe(state);
    });
  });

  describe('pickNutrients', () => {
    it('reads the primary nutrients', () => {
      expect(
        pickNutrients(
          amounts([
            [FDC_NUTRIENT.ENERGY_KCAL, 365],
            [FDC_NUTRIENT.PROTEIN, 7.13],
            [FDC_NUTRIENT.FAT, 0.66],
            [FDC_NUTRIENT.CARBS_BY_DIFFERENCE, 79.95],
          ]),
        ),
      ).toEqual({ kcalPer100g: 365, proteinG: 7.13, fatG: 0.66, carbsG: 79.95 });
    });

    it('falls back to Atwater energy and alternative fat / carbs', () => {
      expect(
        pickNutrients(
          amounts([
            [FDC_NUTRIENT.ENERGY_ATWATER_GENERAL, 100],
            [FDC_NUTRIENT.ENERGY_ATWATER_SPECIFIC, 98.456],
            [FDC_NUTRIENT.PROTEIN, 1],
            [FDC_NUTRIENT.FAT_NLEA, 2],
            [FDC_NUTRIENT.CARBS_BY_SUMMATION, 3],
          ]),
        ),
      ).toEqual({ kcalPer100g: 98.46, proteinG: 1, fatG: 2, carbsG: 3 });
    });

    it('computes energy from the food factors, else from 4/9/4', () => {
      const macros = amounts([
        [FDC_NUTRIENT.PROTEIN, 10],
        [FDC_NUTRIENT.FAT, 10],
        [FDC_NUTRIENT.CARBS_BY_DIFFERENCE, 10],
      ]);

      expect(pickNutrients(macros, { protein: 4.27, fat: 8.79, carbs: 3.82 }).kcalPer100g).toBe(
        168.8,
      );
      expect(pickNutrients(macros).kcalPer100g).toBe(170);
    });

    it('keeps unknown values null and clamps negatives', () => {
      expect(
        pickNutrients(
          amounts([
            [FDC_NUTRIENT.PROTEIN, 5],
            [FDC_NUTRIENT.CARBS_BY_DIFFERENCE, -0.2],
          ]),
        ),
      ).toEqual({ kcalPer100g: null, proteinG: 5, fatG: null, carbsG: 0 });
    });
  });

  describe('buildFoodItems', () => {
    const foods = [
      { fdcId: '1', dataType: 'foundation_food', description: ' Apples, raw ' },
      { fdcId: '2', dataType: 'foundation_food', description: 'Mystery' },
    ];

    it('maps foods and drops those without any value', () => {
      const nutrients = new Map([['1', amounts([[FDC_NUTRIENT.ENERGY_KCAL, 52]])]]);

      expect(buildFoodItems(foods, nutrients)).toEqual([
        {
          name: 'Apples, raw',
          nameEn: 'Apples, raw',
          kcalPer100g: 52,
          proteinG: null,
          fatG: null,
          carbsG: null,
          state: FoodState.Raw,
          source: 'usda_fdc',
          sourceId: '1',
        },
      ]);
    });
  });

  describe('readFdcExport', () => {
    let dir: string;
    const write = (file: string, lines: string[]): void =>
      writeFileSync(join(dir, file), lines.join('\n'));

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'fdc-'));
      write('food.csv', [
        '"fdc_id","data_type","description","food_category_id","publication_date"',
        '"100","foundation_food","Oil, olive, extra virgin","4","2024-04-18"',
        '"101","sub_sample_food","Oil sample, raw","4","2024-04-18"',
        '"102","foundation_food","Lentils, dry","16","2024-04-18"',
      ]);
      write('food_nutrient.csv', [
        '"id","fdc_id","nutrient_id","amount","data_points"',
        '"1","100","1004","100","1"',
        '"2","100","1003","0","1"',
        '"3","100","1005","0","1"',
        '"4","101","1008","900","1"',
        '"5","102","1003","24.6","1"',
        '"6","102","1004","1.06","1"',
        '"7","102","1005","63.4","1"',
        '"8","102","1093","5","1"',
      ]);
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads only the wanted data types and nutrients', async () => {
      const foods = await readFdcExport(dir);

      expect(foods.map((f) => f.sourceId)).toEqual(['100', '102']);
      expect(foods[0]).toMatchObject({ kcalPer100g: 900, fatG: 100, state: FoodState.Other });
      expect(foods[1]).toMatchObject({ proteinG: 24.6, state: FoodState.Dried });
    });

    it('uses the food calorie factors when present', async () => {
      write('food_nutrient_conversion_factor.csv', ['"id","fdc_id"', '"9","102"']);
      write('food_calorie_conversion_factor.csv', [
        '"food_nutrient_conversion_factor_id","protein_value","fat_value","carbohydrate_value"',
        '"9","3.47","8.37","4.07"',
      ]);

      const [, lentils] = await readFdcExport(dir);

      // 24.6 * 3.47 + 1.06 * 8.37 + 63.4 * 4.07 = 85.36 + 8.87 + 258.04 = 352.27
      expect(lentils.kcalPer100g).toBe(352.27);
    });

    it('fails when a required file is missing', async () => {
      rmSync(join(dir, 'food_nutrient.csv'));

      await expect(readFdcExport(dir)).rejects.toThrow('food_nutrient.csv not found');
    });
  });

  describe('readFdcPortions', () => {
    let dir: string;
    const write = (file: string, lines: string[]): void =>
      writeFileSync(join(dir, file), lines.join('\n'));

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'fdc-portions-'));
      write('measure_unit.csv', ['"id","name"', '"1000","cup"', '"9999","undetermined"']);
      write('food_portion.csv', [
        '"id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight"',
        '"1","100","1","1","1000","","chopped","160"',
        '"2","100","2","1","9999","","medium (2-1/2"" dia)","110"',
        '"3","100","3","0.5","9999","","tbsp","5"',
        '"4","100","4","1","9999","","oz","28.35"',
        '"5","200","1","1","9999","","large","50"',
      ]);
    });

    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads volume and count portions per food, grams per one unit', async () => {
      const portions = await readFdcPortions(dir, new Set(['100']));

      expect([...portions.keys()]).toEqual(['100']);
      expect(portions.get('100')).toEqual([
        { unit: 'cup', grams: 160 },
        { unit: 'piece', size: 'medium', grams: 110 },
        { unit: 'tbsp', grams: 10 },
      ]);
    });

    it('returns no portions when the export has no food_portion.csv', async () => {
      rmSync(join(dir, 'food_portion.csv'));

      expect((await readFdcPortions(dir)).size).toBe(0);
    });
  });
});
