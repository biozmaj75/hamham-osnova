// Meal rules and the ordering deadline.
// Variant codes are stored in the database; labels live in the frontend.

export const MEALS = ['B', 'L', 'D'];

export const VARIANTS = {
  B: ['normal', 'veg'],
  L: ['normal', 'veg', 'dry_normal', 'dry_veg', 'late_normal', 'late_veg'],
  D: ['normal', 'veg', 'dry_normal', 'dry_veg', 'late_normal', 'late_veg', 'light'],
};

// 'none' = not registered for that meal
export function validVariant(meal, variant) {
  return variant === 'none' || (VARIANTS[meal] || []).includes(variant);
}

// ISO weekday 1..7 for a 'YYYY-MM-DD' string
export function isoDow(day) {
  const d = new Date(day + 'T12:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}

// Mon–Fri get breakfast + lunch, Mon–Thu also dinner
export function mealServed(day, meal) {
  const dow = isoDow(day);
  if (dow > 5) return false;
  if (dow === 5 && meal === 'D') return false;
  return MEALS.includes(meal);
}

export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00Z'));
}

// Current local date and hour in the dormitory's time zone
export function localNow(timeZone, now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  return {
    today: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

// The first date whose orders may still be changed.
// Orders for day X close at <cutoffHour>:00 on day X-1.
export function firstEditableDay(timeZone, cutoffHour, now = new Date()) {
  const { today, hour } = localNow(timeZone, now);
  return addDays(today, hour < cutoffHour ? 1 : 2);
}
