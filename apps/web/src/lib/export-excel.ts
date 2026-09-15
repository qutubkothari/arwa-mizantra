/**
 * Lightweight Excel/CSV export utility.
 * Generates a proper UTF-8 CSV file that Excel opens natively.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function exportToExcel(rows: any[], columns: { header: string; key: string }[], filename: string) {
  const header = columns.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',');
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key];
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      })
      .join(',')
  );
  const csv = '\uFEFF' + [header, ...body].join('\r\n'); // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
