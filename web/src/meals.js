export const MEALS = ['B', 'L', 'D'];

export const MEAL_NAMES = { B: 'Breakfast', L: 'Lunch', D: 'Dinner' };

export const VARIANTS = {
  B: ['normal', 'veg'],
  L: ['normal', 'veg', 'dry_normal', 'dry_veg', 'late_normal', 'late_veg'],
  D: ['normal', 'veg', 'dry_normal', 'dry_veg', 'late_normal', 'late_veg', 'light'],
};

export const ALL_VARIANTS = VARIANTS.D;

export const VARIANT_LABEL = {
  none: 'Not registered',
  normal: 'Normal',
  veg: 'Vegetarian',
  dry_normal: 'Dry normal',
  dry_veg: 'Dry vegetarian',
  late_normal: 'Late normal',
  late_veg: 'Late vegetarian',
  light: 'Light',
};

export const VARIANT_SHORT = {
  none: '–',
  normal: 'N',
  veg: 'V',
  dry_normal: 'DN',
  dry_veg: 'DV',
  late_normal: 'LN',
  late_veg: 'LV',
  light: 'Li',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const at = day => new Date(day + 'T12:00:00Z');

export function addDays(day, n) {
  const d = at(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dow(day) { return at(day).getUTCDay(); }

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

export function studentName(s) { return `${s.last_name} ${s.first_name}`; }
