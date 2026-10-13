import { ActivityLevel, Goal, Sex } from '../../../common/constants';
import {
  ACTIVITY_FACTORS,
  basalMetabolicRate,
  calculateNutritionTargets,
  EnergyInput,
  GOAL_RULES,
} from './energy-requirements';

describe('energy requirements', () => {
  const woman: EnergyInput = {
    age: 30,
    heightCm: 170,
    weightKg: 65,
    sex: Sex.Female,
    activityLevel: ActivityLevel.Moderate,
    goal: Goal.Maintain,
  };

  describe('basalMetabolicRate (Mifflin-St Jeor)', () => {
    it('female: 10*65 + 6.25*170 - 5*30 - 161 = 1401.5', () => {
      expect(basalMetabolicRate(woman)).toBe(1401.5);
    });

    it('male: 10*80 + 6.25*180 - 5*40 + 5 = 1730', () => {
      expect(
        basalMetabolicRate({ ...woman, sex: Sex.Male, weightKg: 80, heightCm: 180, age: 40 }),
      ).toBe(1730);
    });
  });

  it('covers every activity level and goal', () => {
    expect(Object.keys(ACTIVITY_FACTORS).sort()).toEqual(Object.values(ActivityLevel).sort());
    expect(Object.keys(GOAL_RULES).sort()).toEqual(Object.values(Goal).sort());
  });

  describe('calculateNutritionTargets', () => {
    it('maintain: TDEE, 1.6 g/kg protein, 25 % fat, carbs for the rest', () => {
      // 1401.5 * 1.55 = 2172.3 kcal; protein 104 g; fat 2172.3 * .25 / 9 = 60.3 g;
      // carbs (2172.3 - 416 - 543.1) / 4 = 303.3 g
      expect(calculateNutritionTargets(woman)).toEqual({
        caloriesKcal: 2172,
        proteinG: 104,
        fatG: 60,
        carbsG: 303,
      });
    });

    it('lose weight: 15 % deficit, 2 g/kg protein', () => {
      // 2172.3 * .85 = 1846.5; protein 130; fat 51.3; carbs (1846.5 - 520 - 461.6) / 4 = 216.2
      expect(calculateNutritionTargets({ ...woman, goal: Goal.LoseWeight })).toEqual({
        caloriesKcal: 1846,
        proteinG: 130,
        fatG: 51,
        carbsG: 216,
      });
    });

    it('gain muscle: 10 % surplus, 1.8 g/kg protein', () => {
      const result = calculateNutritionTargets({ ...woman, goal: Goal.GainMuscle });

      expect(result.caloriesKcal).toBe(2390);
      expect(result.proteinG).toBe(117);
    });

    it('never returns negative carbs', () => {
      const result = calculateNutritionTargets({
        ...woman,
        weightKg: 300,
        heightCm: 100,
        age: 100,
        activityLevel: ActivityLevel.Sedentary,
        goal: Goal.LoseWeight,
      });

      expect(result.carbsG).toBeGreaterThanOrEqual(0);
    });
  });
});
