/**
 * Organization names are unique the way usernames are: case-insensitively,
 * and ignoring stray spacing. "Volvo", "VOLVO" and "  volvo " are one name.
 *
 * The name a person typed is still stored and shown exactly as typed; this
 * key — always lower case — is what the database's unique index holds, so
 * the rule is enforced by PostgreSQL rather than by a read-then-write check.
 * The migration that introduced it backfilled existing rows with the SQL
 * equivalent (NFKC + collapsed whitespace + trim + lower). Changing this
 * function means re-keying every existing row, so treat it as frozen.
 */
export function organizationNameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
