export const MEALS = ['B', 'L', 'D'];

export const MEAL_NAMES = { B: 'Zajtrk', L: 'Kosilo', D: 'Večerja' };

export const MEAL_SHORT = { B: 'Za', L: 'Ko', D: 'Ve' };

export const VARIANTS = {
  B: ['normal', 'veg'],
  L: ['normal', 'veg', 'dry_normal', 'dry_veg', 'late_normal', 'late_veg'],
  D: ['normal', 'veg', 'dry_normal', 'dry_veg', 'late_normal', 'late_veg', 'light'],
};

export const ALL_VARIANTS = VARIANTS.D;

// Dishes the menu planner enters; late meals get the same dish as normal/vegetarian
export const MENU_VARIANTS = {
  B: ['normal', 'veg'],
  L: ['normal', 'veg', 'dry_normal', 'dry_veg'],
  D: ['normal', 'veg', 'dry_normal', 'dry_veg', 'light'],
};

const MENU_SOURCE = { late_normal: 'normal', late_veg: 'veg' };

// menu: [{day, meal, variant, dish}] -> dish for a variant (late meals use the normal/vegetarian dish)
export function dishFor(menu, day, meal, variant) {
  const v = MENU_SOURCE[variant] || variant;
  return menu?.find(m => m.day === day && m.meal === meal && m.variant === v)?.dish || '';
}

export const DEF_COL = { B: 'def_b', L: 'def_l', D: 'def_d' };

// ISO weekdays 1–5 for weekday exceptions
export const WEEKDAYS = [[1, 'ponedeljek'], [2, 'torek'], [3, 'sreda'], [4, 'četrtek'], [5, 'petek']];

export const VARIANT_LABEL = {
  none: 'Ni prijavljen',
  normal: 'Navadni',
  veg: 'Vegetarijanski',
  dry_normal: 'Suhi navadni',
  dry_veg: 'Suhi vegetarijanski',
  late_normal: 'Pozni navadni',
  late_veg: 'Pozni vegetarijanski',
  light: 'Lahki',
};

export const VARIANT_SHORT = {
  none: '–',
  normal: 'N',
  veg: 'V',
  dry_normal: 'SN',
  dry_veg: 'SV',
  late_normal: 'PN',
  late_veg: 'PV',
  light: 'La',
};

const DAY_NAMES = ['ned', 'pon', 'tor', 'sre', 'čet', 'pet', 'sob'];
const LONG_DAY_NAMES = ['nedelja', 'ponedeljek', 'torek', 'sreda', 'četrtek', 'petek', 'sobota'];

const at = day => new Date(day + 'T12:00:00Z');

export function addDays(day, n) {
  const d = at(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dow(day) { return at(day).getUTCDay(); }

// Weekday exception for that day if there is one, otherwise the student's default menu
export function weeklyVariant(student, day, meal) {
  return student.weekly?.[dow(day)]?.[meal] || '';
}

export function defaultVariant(student, day, meal) {
  return weeklyVariant(student, day, meal) || student[DEF_COL[meal]];
}

export function mondayOf(day) {
  const w = dow(day);
  return addDays(day, w === 0 ? -6 : 1 - w);
}

// The Monday of the first week that still has an editable school day
export function startWeek(firstEditable) {
  const w = dow(firstEditable);
  return w === 6 || w === 0 ? mondayOf(addDays(firstEditable, 2)) : mondayOf(firstEditable);
}

export function nextSchoolDay(day) {
  let d = day;
  while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
  return d;
}

export function mealServed(day, meal) {
  const w = dow(day);
  if (w === 0 || w === 6) return false;
  return !(w === 5 && meal === 'D');
}

export function dayShort(day) { return DAY_NAMES[dow(day)]; }

export function fmtDay(day) {
  const d = at(day);
  return `${d.getUTCDate()}. ${d.getUTCMonth() + 1}.`;
}

export function fmtLong(day) {
  const d = at(day);
  return `${LONG_DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()}. ${d.getUTCMonth() + 1}. ${d.getUTCFullYear()}`;
}

export const capitalize = t => t.charAt(0).toUpperCase() + t.slice(1);

// Slovenian plural: 1 obrok, 2 obroka, 3–4 obroki, 5+ obrokov (by the last two digits)
export function plural(n, one, two, few, many) {
  const r = n % 100;
  return r === 1 ? one : r === 2 ? two : r === 3 || r === 4 ? few : many;
}

export function studentName(s) { return `${s.last_name} ${s.first_name}`; }

export const ROLE_NAME = {
  admin: 'Skrbnik', principal: 'Ravnatelj', teacher: 'Vzgojitelj', dietitian: 'Organizator prehrane', kitchen: 'Kuhinja', office: 'Tajništvo', guard: 'Nočni varnostnik', student: 'Dijak',
};

// Meal ratings (mirror of the server rule): 1 = very bad … 5 = excellent
export const SCORE_LABEL = { 1: 'zelo slab', 2: 'slab', 3: 'povprečen', 4: 'dober', 5: 'odličen' };

// Different words of 3 or more letters in a rating's reason
export function reasonWords(text) {
  const words = String(text || '').toLowerCase().split(/\s+/)
    .map(w => w.replace(/[^\p{L}]/gu, ''))
    .filter(w => w.length >= 3);
  return new Set(words).size;
}
