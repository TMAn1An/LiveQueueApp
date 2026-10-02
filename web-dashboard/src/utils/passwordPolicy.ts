/**
 * The account password policy, as the backend enforces it
 * (backend/src/validators/auth.validators.ts passwordSchema): at least 8
 * characters, with a letter and a number. Shown while typing; the backend
 * still decides.
 */
export function passwordPolicyError(password: string): string | null {
  if (password.length === 0) return null;
  if (password.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(password)) return 'Include at least one letter.';
  if (!/[0-9]/.test(password)) return 'Include at least one number.';
  return null;
}
