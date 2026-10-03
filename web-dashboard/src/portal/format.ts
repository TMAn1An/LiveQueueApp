/** Wording shared by the portal's pages. */

export function minutesLabel(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 1) return 'Less than a minute';
  if (minutes < 60) return `About ${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `About ${h} h ${m} min` : `About ${h} h`;
}

export function peopleWaiting(count: number): string {
  return count === 1 ? '1 person waiting' : `${count} people waiting`;
}
