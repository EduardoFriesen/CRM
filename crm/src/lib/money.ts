const whole = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });

// "$2.500" for round prices, "$2.500,50" otherwise. Intl may insert a (narrow) no-break space.
export function formatPrice(value: string | number): string {
  const n = Number(value);
  return (Number.isInteger(n) ? whole : cents).format(n).replace(/\s/g, "");
}
