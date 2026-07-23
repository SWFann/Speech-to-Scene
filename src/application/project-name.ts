/**
 * Project names are direct workspace child directory names.
 *
 * Keep this validation shared by create, switch, and delete paths so an HTTP
 * caller can never turn a project name into an arbitrary filesystem path.
 */
export function isValidProjectName(name: string): boolean {
  if (!name || name !== name.trim()) return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name === "." || name === ".." || name.startsWith(".")) return false;
  if (/[<>:"|?*]/.test(name) || name.endsWith(".") || name.endsWith(" ")) return false;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return true;
}
