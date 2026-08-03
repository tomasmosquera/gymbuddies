/**
 * Curated IANA timezones offered in the group timezone picker (create-group,
 * admin-edit-group). Every value here has a matching entry in
 * TIMEZONE_COUNTRY (src/lib/domain/badges.ts), so picking one always maps to
 * a real fixed-holiday list — an admin can't accidentally choose a timezone
 * whose holidays fall back to Colombia's by omission. Deliberately not the
 * full ~400-zone IANA list — just the markets this app's groups actually
 * live in today; add more here (and to TIMEZONE_COUNTRY) as that grows.
 */
export interface GroupTimezoneOption {
  value: string;
  label: string;
}

export const GROUP_TIMEZONE_OPTIONS: GroupTimezoneOption[] = [
  { value: 'America/Bogota', label: 'Colombia (Bogotá)' },
  { value: 'America/Mexico_City', label: 'México (Ciudad de México)' },
  { value: 'America/Lima', label: 'Perú (Lima)' },
  { value: 'America/Santiago', label: 'Chile (Santiago)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (Buenos Aires)' },
  { value: 'America/New_York', label: 'EE. UU. — Este (Nueva York)' },
  { value: 'America/Chicago', label: 'EE. UU. — Central (Chicago)' },
  { value: 'America/Los_Angeles', label: 'EE. UU. — Pacífico (Los Ángeles)' },
  { value: 'Europe/Madrid', label: 'España (Madrid)' },
  { value: 'Asia/Shanghai', label: 'China (Shanghái)' },
];

export const DEFAULT_GROUP_TIMEZONE = 'America/Bogota';

export function groupTimezoneLabel(value: string): string {
  return GROUP_TIMEZONE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
