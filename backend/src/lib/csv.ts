// CSV with protection against spreadsheet formula injection (cells starting with = + - @ are prefixed with ').
const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCsv = (headers: string[], rows: unknown[][]) => [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
