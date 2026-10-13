import {
  ActivityLevel,
  Goal,
  MACRO_SHARE_LIMITS,
  MACRO_SHARE_TOLERANCE,
  MacroName,
  MAX_DAILY_CALORIES_KCAL,
  MIN_DAILY_CALORIES_KCAL,
  PROFILE_LIMITS,
  Sex,
} from '../../../common/constants';
import {
  ACTIVITY_FACTORS,
  basalMetabolicRate,
  calculateNutritionTargets,
  EnergyInput,
  GOAL_RULES,
  macroEnergy,
  macrosForCalories,
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

    it('raises calories to the minimum for the sex', () => {
      // 10*30 + 6.25*100 - 5*14 - 161 = 694 * 1.2 * .85 = 708 kcal
      const result = calculateNutritionTargets({
        ...woman,
        age: 14,
        heightCm: 100,
        weightKg: 30,
        activityLevel: ActivityLevel.Sedentary,
        goal: Goal.LoseWeight,
      });

      expect(result.caloriesKcal).toBe(MIN_DAILY_CALORIES_KCAL[Sex.Female]);
    });

    it('caps calories and protein for extreme profiles', () => {
      // 10*300 + 6.25*250 - 5*14 + 5 = 4560 * 1.9 * 1.1 = 9530 kcal; 300 kg * 1.8 = 540 g protein
      const result = calculateNutritionTargets({
        ...woman,
        sex: Sex.Male,
        age: 14,
        heightCm: 250,
        weightKg: 300,
        activityLevel: ActivityLevel.VeryActive,
        goal: Goal.GainMuscle,
      });

      // protein 30 % of 6000 kcal = 450 g; fat 166.7 g; carbs (6000 - 1800 - 1500) / 4 = 675 g
      expect(result).toEqual({
        caloriesKcal: MAX_DAILY_CALORIES_KCAL,
        proteinG: 450,
        fatG: 167,
        carbsG: 675,
      });
    });

    it('always lands inside the macro share limits', () => {
      const { age, heightCm, weightKg } = PROFILE_LIMITS;
      for (const sex of Object.values(Sex))
        for (const activityLevel of Object.values(ActivityLevel))
          for (const goal of Object.values(Goal))
            for (const a of [age.min, age.max])
              for (const h of [heightCm.min, 170, heightCm.max])
                for (const w of [weightKg.min, 70, weightKg.max]) {
                  const targets = calculateNutritionTargets({
                    sex,
                    activityLevel,
                    goal,
                    age: a,
                    heightCm: h,
                    weightKg: w,
                  });
                  const { shares } = macroEnergy(targets);

                  expect(targets.caloriesKcal).toBeGreaterThanOrEqual(MIN_DAILY_CALORIES_KCAL[sex]);
                  expect(targets.caloriesKcal).toBeLessThanOrEqual(MAX_DAILY_CALORIES_KCAL);
                  for (const macro of Object.keys(shares) as MacroName[]) {
                    const limits = MACRO_SHARE_LIMITS[macro];
                    expect(shares[macro]).toBeGreaterThanOrEqual(
                      limits.min - MACRO_SHARE_TOLERANCE,
                    );
                    expect(shares[macro]).toBeLessThanOrEqual(limits.max + MACRO_SHARE_TOLERANCE);
                  }
                }
    });
  });

  describe('macrosForCalories', () => {
    it('keeps the calories, protein by the goal, 25 % fat, carbs for the rest', () => {
      // protein 65 * 1.6 = 104; fat 1500 * .25 / 9 = 41.7; carbs (1500 - 416 - 375) / 4 = 177.3
      expect(macrosForCalories(1500, 65, Goal.Maintain)).toEqual({
        caloriesKcal: 1500,
        proteinG: 104,
        fatG: 42,
        carbsG: 177,
      });
    });

    it('caps protein at 30 % of the calories', () => {
      // 100 kg * 2 g = 200 g; 30 % of 1500 kcal = 112.5 g; carbs (1500 - 450 - 375) / 4 = 168.75
      expect(macrosForCalories(1500, 100, Goal.LoseWeight)).toEqual({
        caloriesKcal: 1500,
        proteinG: 113,
        fatG: 42,
        carbsG: 169,
      });
    });

    it('raises protein to 10 % of the calories', () => {
      // 30 kg * 1.6 = 48 g; 10 % of 3000 kcal = 75 g; carbs (3000 - 300 - 750) / 4 = 487.5
      expect(macrosForCalories(3000, 30, Goal.Maintain)).toEqual({
        caloriesKcal: 3000,
        proteinG: 75,
        fatG: 83,
        carbsG: 488,
      });
    });
  });

  describe('macroEnergy', () => {
    it('sums 4/9/4 kcal and the share of each macro', () => {
      // 100*4 + 50*9 + 200*4 = 400 + 450 + 800 = 1650
      const { kcal, shares } = macroEnergy({ proteinG: 100, fatG: 50, carbsG: 200 });

      expect(kcal).toBe(1650);
      expect(shares.protein).toBeCloseTo(400 / 1650);
      expect(shares.fat).toBeCloseTo(450 / 1650);
      expect(shares.carbs).toBeCloseTo(800 / 1650);
    });

    it('gives zero shares without energy', () => {
      expect(macroEnergy({ proteinG: 0, fatG: 0, carbsG: 0 })).toEqual({
        kcal: 0,
        shares: { protein: 0, fat: 0, carbs: 0 },
      });
    });
  });
});
