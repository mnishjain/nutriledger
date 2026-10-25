// Personalised daily targets with documented sources. Non-diagnostic, adult (18+) only.
import { isNum } from './nutrients.js';

export const REFS = {
  icmr: 'ICMR-NIN Nutrient Requirements for Indians 2020 (RDA/EAR, Tables 3–4)',
  whoFat: 'WHO guideline on fats and carbohydrates, July 2023',
  whoNa: 'WHO / ICMR-NIN: salt below 5 g/day (≈2,000 mg sodium)',
  whoK: 'WHO 2012: potassium at least 3,510 mg/day for adults',
  morton: 'Morton et al., Br J Sports Med 2018: gains plateau ≈1.6 g/kg/day',
  mifflin: 'Mifflin–St Jeor equation (1990) × activity factor',
  floor: 'Common clinical convention: avoid unsupervised intake below ~1,500 kcal (men) / ~1,200 kcal (women)',
};

// ICMR-NIN 2020 adult values: [RDA, EAR]
const MICRO = {
  male: { calcium: [1000, 800], magnesium: [440, 370], iron: [19, 11], zinc: [17, 14], vitc: [80, 65], folate: [300, 250], b12: [2.2, 2] },
  female: { calcium: [1000, 800], magnesium: [370, 310], iron: [29, 15], zinc: [13, 11], vitc: [65, 55], folate: [220, 180], b12: [2.2, 2] },
};

export const ACTIVITY = {
  sedentary: { factor: 1.2, label: 'Sedentary (desk job, little exercise)' },
  light: { factor: 1.375, label: 'Lightly active (exercise 1–3 days/week)' },
  moderate: { factor: 1.55, label: 'Moderately active (exercise 3–5 days/week)' },
  very: { factor: 1.725, label: 'Very active (hard exercise 6–7 days/week)' },
};
export const GOALS = {
  lose: { label: 'Lose fat, keep/build muscle' },
  maintain: { label: 'Maintain weight' },
  gain: { label: 'Gain muscle (small surplus)' },
};

export function bmr({ sex, weightKg, heightCm, age }) {
  if (![weightKg, heightCm, age].every((v) => isNum(v) && v > 0)) return null;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'female' ? -161 : 5);
}

export function validateProfile(p) {
  const e = [];
  if (!p.name || !String(p.name).trim()) e.push('Name is required');
  if (!(p.age >= 18 && p.age <= 100)) e.push('Age must be 18–100 (targets are for adults)');
  if (!(p.heightCm >= 120 && p.heightCm <= 230)) e.push('Height must be 120–230 cm');
  if (!(p.weightKg >= 30 && p.weightKg <= 250)) e.push('Weight must be 30–250 kg');
  if (!['male', 'female'].includes(p.sex)) e.push('Select sex used for energy equations');
  if (!ACTIVITY[p.activity]) e.push('Select activity level');
  if (!GOALS[p.goal]) e.push('Select goal');
  return e;
}

/**
 * Returns { kcal, protein, ... } where each target is
 * { kind: 'max'|'min'|'rda'|'info', value, ear?, unit, source, why, auto }.
 * kind 'max' = upper limit; 'min' = lower goal; 'rda' = RDA with EAR used for pattern detection.
 */
export function computeTargets(p) {
  const sex = p.sex === 'female' ? 'female' : 'male';
  const B = bmr(p);
  const act = ACTIVITY[p.activity] || ACTIVITY.light;
  const tdee = B ? B * act.factor : null;
  const floor = Math.max(B || 0, sex === 'female' ? 1200 : 1500);
  let kcal = null; let kcalWhy = '';
  if (tdee) {
    if (p.goal === 'lose') {
      const rate = isNum(p.rateKgWk) ? p.rateKgWk : 0.35;
      const deficit = Math.min((rate * 7700) / 7, tdee * 0.25);
      kcal = Math.max(tdee - deficit, floor);
      kcalWhy = `Maintenance ≈ ${Math.round(tdee)} kcal (BMR ${Math.round(B)} × ${act.factor}); deficit ≈ ${Math.round(tdee - kcal)} kcal/day for ≈${rate} kg/week, never below ${Math.round(floor)} kcal.`;
    } else if (p.goal === 'gain') {
      kcal = tdee + 250; kcalWhy = `Maintenance ≈ ${Math.round(tdee)} kcal + 250 kcal surplus.`;
    } else { kcal = tdee; kcalWhy = `Maintenance ≈ ${Math.round(tdee)} kcal (BMR ${Math.round(B)} × ${act.factor}).`; }
    kcal = Math.round(kcal / 10) * 10;
  }
  const training = p.training !== false;
  const gPerKg = training ? (p.goal === 'maintain' ? 1.4 : 1.6) : 0.83;
  const protein = isNum(p.weightKg) ? Math.round(p.weightKg * gPerKg) : null;
  const t = {
    kcal: { kind: 'target', value: kcal, unit: 'kcal', source: REFS.mifflin, why: kcalWhy, floor: Math.round(floor), maintenance: tdee ? Math.round(tdee) : null },
    protein: { kind: 'min', value: protein, ear: isNum(p.weightKg) ? Math.round(p.weightKg * 0.66) : null, unit: 'g',
      source: training ? REFS.morton : REFS.icmr,
      why: training ? `${gPerKg} g per kg body weight supports muscle gain/retention with strength training (ICMR minimum RDA is 0.83 g/kg).` : 'ICMR RDA 0.83 g per kg body weight.' },
    fibre: { kind: 'min', value: 25, unit: 'g', source: REFS.whoFat, why: 'At least 25 g/day of naturally occurring fibre.' },
    satfat: { kind: 'max', value: kcal ? Math.round((kcal * 0.10) / 9) : null, unit: 'g', source: REFS.whoFat, why: 'Below 10% of calories.' },
    sodium: { kind: 'max', value: 2000, unit: 'mg', source: REFS.whoNa, why: 'Below 2,000 mg sodium (5 g salt). Low recorded sodium is never treated as deficiency.' },
    potassium: { kind: 'min', value: 3510, unit: 'mg', source: REFS.whoK, why: 'At least 3,510 mg/day (unless a doctor has advised otherwise).' },
  };
  for (const [k, [rda, ear]] of Object.entries(MICRO[sex])) {
    t[k] = { kind: 'rda', value: rda, ear, unit: k === 'folate' || k === 'b12' ? 'µg' : 'mg', source: REFS.icmr, why: `ICMR 2020 RDA ${rda}; average requirement (EAR) ${ear}.` };
  }
  t.carbs = { kind: 'info', value: null, unit: 'g', source: '', why: 'No separate target; follows from calories, protein and fat.' };
  t.fat = { kind: 'info', value: null, unit: 'g', source: '', why: 'No separate target; saturated fat is limited instead.' };
  t.sugar = { kind: 'info', value: null, unit: 'g', source: '', why: 'Total sugar includes natural milk and fruit sugars; WHO limits apply to free sugars, which labels rarely separate.' };
  // User overrides (only kcal and protein are user-settable; others stay evidence-based)
  for (const k of ['kcal', 'protein']) {
    const o = p.overrides?.[k];
    if (isNum(o) && o > 0) { t[k] = { ...t[k], auto: t[k].value, value: o, overridden: true }; }
  }
  return t;
}
