const moneyFormatter = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
});

export function money(value?: number | null) {
  return value == null ? "-" : moneyFormatter.format(value);
}

export function niceDate(value?: string) {
  if (!value) return "No scan yet";
  return new Date(value).toLocaleString("en-ZA", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}
