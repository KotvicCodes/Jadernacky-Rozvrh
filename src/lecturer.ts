/** Remove a repeated trailing initial: "P. Novotný P" → "P. Novotný". */
export function normalizeLecturerInitials(text: string): string {
  let value = text;
  for (;;) {
    const match = /^(\p{L})\.\s+(.+?)\s+(\p{L})\.?$/u.exec(value);
    // Require a surname and an explicitly repeated leading initial. Distinct
    // initials and surname-first labels such as "Novotný P." are kept.
    if (!match || match[1]!.toUpperCase() !== match[3]!.toUpperCase() || !/\p{L}{2}/u.test(match[2]!)) return value;
    value = `${match[1]}. ${match[2]}`;
  }
}
