const EARTH_RADIUS_METERS = 6371000;

/** Informational threshold for flagging a checkout photo taken far from the checkin photo's location — see the "Ubicación distinta" badge on DayCheckinRow/home. Not a validity rule by itself; members still vote if they want to invalidate. */
export const CHECKIN_LOCATION_MISMATCH_METERS = 300;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle (haversine) distance between two coordinates, in meters. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}
