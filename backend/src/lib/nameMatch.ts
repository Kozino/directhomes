// Does the bank account name belong to this person? Order and punctuation don't matter ("OKAFOR CHINEDU J" = "Chinedu Okafor").
// At least two words must overlap (or all of them, for very short names). Anything else goes to an admin.
const words = (s: string) => new Set(s.toUpperCase().replace(/[^A-Z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1));
export function accountNameMatches(accountName: string, fullName: string) {
  const a = words(accountName), b = words(fullName);
  if (!a.size || !b.size) return false;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common >= Math.min(2, a.size, b.size);
}
