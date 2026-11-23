import type { OrderView } from "./orders";

const baDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

export const todayInBuenosAires = (now: Date = new Date()): string => baDay.format(now);

const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export type OrderGroups<T> = { overdue: T[]; today: T[]; tomorrow: T[]; upcoming: T[] };

// Pending orders by delivery day, as the business sees the calendar (Buenos Aires).
export function groupOrders<T extends Pick<OrderView, "deliveryDate">>(orders: T[], now: Date): OrderGroups<T> {
  const today = todayInBuenosAires(now);
  const tomorrow = addDays(today, 1);
  const groups: OrderGroups<T> = { overdue: [], today: [], tomorrow: [], upcoming: [] };
  for (const o of orders) {
    if (o.deliveryDate < today) groups.overdue.push(o);
    else if (o.deliveryDate === today) groups.today.push(o);
    else if (o.deliveryDate === tomorrow) groups.tomorrow.push(o);
    else groups.upcoming.push(o);
  }
  return groups;
}
