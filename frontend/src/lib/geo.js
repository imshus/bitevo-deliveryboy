// Distances and links for the map.

export function distanceM(a, b) {
  if (!a || !b) return null;
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

export const hasPoint = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

// Turn-by-turn directions in Google Maps (the app on phones), to a map pin or else to the address text.
export function directionsUrl(to, addressText) {
  const destination = hasPoint(to) ? `${to.lat},${to.lng}` : addressText;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination || '')}&travelmode=driving`;
}

// The address as one line, as a rider reads it at the door.
export const addressLine = a => [a?.line1, a?.line2].filter(Boolean).join(', ') || a?.mapAddress || '';
