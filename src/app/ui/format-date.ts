/** Medium date, plus short time unless `dateOnly`, in the viewer's locale and time zone. */
export function formatDate(value: string, dateOnly: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { dateStyle: "medium" }
    : { dateStyle: "medium", timeStyle: "short" };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}
