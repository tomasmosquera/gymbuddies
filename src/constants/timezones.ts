/**
 * IANA timezones offered in the group timezone picker (create-group,
 * admin-edit-group). Every value here has a matching entry in
 * TIMEZONE_COUNTRY (src/lib/domain/badges.ts), so picking one always maps to
 * a real fixed-holiday list — an admin can't accidentally choose a timezone
 * whose holidays fall back to Colombia's by omission. Grouped by region so
 * the picker can show section headers; add more here (and to
 * TIMEZONE_COUNTRY + FIXED_HOLIDAYS_BY_COUNTRY) as that grows.
 */
export interface GroupTimezoneOption {
  value: string;
  label: string;
  group: string;
}

export const GROUP_TIMEZONE_OPTIONS: GroupTimezoneOption[] = [
  // Latinoamérica
  { value: 'America/Bogota', label: 'Colombia (Bogotá)', group: 'Latinoamérica' },
  { value: 'America/Mexico_City', label: 'México (Ciudad de México)', group: 'Latinoamérica' },
  { value: 'America/Lima', label: 'Perú (Lima)', group: 'Latinoamérica' },
  { value: 'America/Santiago', label: 'Chile (Santiago)', group: 'Latinoamérica' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)', group: 'Latinoamérica' },
  { value: 'America/Caracas', label: 'Venezuela (Caracas)', group: 'Latinoamérica' },
  { value: 'America/Guayaquil', label: 'Ecuador (Guayaquil)', group: 'Latinoamérica' },
  { value: 'America/La_Paz', label: 'Bolivia (La Paz)', group: 'Latinoamérica' },
  { value: 'America/Asuncion', label: 'Paraguay (Asunción)', group: 'Latinoamérica' },
  { value: 'America/Montevideo', label: 'Uruguay (Montevideo)', group: 'Latinoamérica' },
  { value: 'America/Panama', label: 'Panamá (Ciudad de Panamá)', group: 'Latinoamérica' },
  { value: 'America/Costa_Rica', label: 'Costa Rica (San José)', group: 'Latinoamérica' },
  { value: 'America/Guatemala', label: 'Guatemala (Ciudad de Guatemala)', group: 'Latinoamérica' },
  { value: 'America/Tegucigalpa', label: 'Honduras (Tegucigalpa)', group: 'Latinoamérica' },
  { value: 'America/El_Salvador', label: 'El Salvador (San Salvador)', group: 'Latinoamérica' },
  { value: 'America/Managua', label: 'Nicaragua (Managua)', group: 'Latinoamérica' },
  { value: 'America/Santo_Domingo', label: 'República Dominicana (Santo Domingo)', group: 'Latinoamérica' },
  { value: 'America/Havana', label: 'Cuba (La Habana)', group: 'Latinoamérica' },
  { value: 'America/Puerto_Rico', label: 'Puerto Rico (San Juan)', group: 'Latinoamérica' },
  { value: 'America/Sao_Paulo', label: 'Brasil (São Paulo)', group: 'Latinoamérica' },

  // Norteamérica
  { value: 'America/New_York', label: 'EE. UU. — Este (Nueva York)', group: 'Norteamérica' },
  { value: 'America/Chicago', label: 'EE. UU. — Central (Chicago)', group: 'Norteamérica' },
  { value: 'America/Denver', label: 'EE. UU. — Montaña (Denver)', group: 'Norteamérica' },
  { value: 'America/Los_Angeles', label: 'EE. UU. — Pacífico (Los Ángeles)', group: 'Norteamérica' },
  { value: 'America/Toronto', label: 'Canadá — Este (Toronto)', group: 'Norteamérica' },
  { value: 'America/Vancouver', label: 'Canadá — Pacífico (Vancouver)', group: 'Norteamérica' },

  // Europa
  { value: 'Europe/Madrid', label: 'España (Madrid)', group: 'Europa' },
  { value: 'Europe/Lisbon', label: 'Portugal (Lisboa)', group: 'Europa' },
  { value: 'Europe/London', label: 'Reino Unido (Londres)', group: 'Europa' },
  { value: 'Europe/Paris', label: 'Francia (París)', group: 'Europa' },
  { value: 'Europe/Berlin', label: 'Alemania (Berlín)', group: 'Europa' },
  { value: 'Europe/Rome', label: 'Italia (Roma)', group: 'Europa' },

  // Asia y Oceanía
  { value: 'Asia/Shanghai', label: 'China (Shanghái)', group: 'Asia y Oceanía' },
  { value: 'Asia/Tokyo', label: 'Japón (Tokio)', group: 'Asia y Oceanía' },
  { value: 'Australia/Sydney', label: 'Australia (Sídney)', group: 'Asia y Oceanía' },
];

export const DEFAULT_GROUP_TIMEZONE = 'America/Bogota';

export function groupTimezoneLabel(value: string): string {
  return GROUP_TIMEZONE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/**
 * "GMT-5" / "GMT+1" style offset for `timezone`, evaluated at `date`
 * (defaults to now) — computed from `Intl.DateTimeFormat`, not hardcoded, so
 * DST-observing zones (US, Chile, Europe, ...) always show their current
 * offset instead of going stale part of the year.
 */
export function timezoneOffsetLabel(timezone: string, date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  const offsetMinutes = Math.round((asUtcMs - date.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0 ? `GMT${sign}${hours}` : `GMT${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}
