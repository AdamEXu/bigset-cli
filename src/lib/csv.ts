function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  const columns = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      for (const key of Object.keys(row)) set.add(key);
      return set;
    }, new Set()),
  );

  const lines = [
    columns.map(escapeCsvValue).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsvValue(row[column])).join(",")),
  ];

  return `${lines.join("\n")}\n`;
}
