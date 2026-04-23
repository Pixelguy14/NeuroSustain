// ============================================================
// NeuroSustain — Currency Denomination Registry
// Integer-based financial math (all values in centavos/cents)
// ============================================================

export interface Denomination {
  /** Value in smallest unit (cents/centavos) */
  value: number;
  /** Display label */
  label: string;
  /** Visual type */
  type: 'bill' | 'coin';
  /** Render color */
  color: string;
}

export const USD_DENOMINATIONS: Denomination[] = [
  { value: 10000, label: '$100', type: 'bill', color: 'hsl(145, 40%, 45%)' },
  { value: 2000,  label: '$20',  type: 'bill', color: 'hsl(145, 40%, 45%)' },
  { value: 1000,  label: '$10',  type: 'bill', color: 'hsl(145, 40%, 45%)' },
  { value: 500,   label: '$5',   type: 'bill', color: 'hsl(145, 40%, 45%)' },
  { value: 100,   label: '$1',   type: 'bill', color: 'hsl(145, 40%, 45%)' },
  { value: 25,    label: '25¢',  type: 'coin', color: 'hsl(45, 50%, 60%)' },
  { value: 10,    label: '10¢',  type: 'coin', color: 'hsl(45, 50%, 60%)' },
  { value: 5,     label: '5¢',   type: 'coin', color: 'hsl(220, 15%, 55%)' },
  { value: 1,     label: '1¢',   type: 'coin', color: 'hsl(20, 60%, 50%)' },
];

export const MXN_DENOMINATIONS: Denomination[] = [
  { value: 50000, label: '$500', type: 'bill', color: 'hsl(210, 60%, 50%)' },
  { value: 20000, label: '$200', type: 'bill', color: 'hsl(145, 50%, 45%)' },
  { value: 10000, label: '$100', type: 'bill', color: 'hsl(0, 55%, 50%)' },
  { value: 5000,  label: '$50',  type: 'bill', color: 'hsl(300, 40%, 45%)' },
  { value: 2000,  label: '$20',  type: 'bill', color: 'hsl(210, 50%, 55%)' },
  { value: 1000,  label: '$10',  type: 'coin', color: 'hsl(45, 55%, 55%)' },
  { value: 500,   label: '$5',   type: 'coin', color: 'hsl(45, 50%, 60%)' },
  { value: 200,   label: '$2',   type: 'coin', color: 'hsl(45, 50%, 55%)' },
  { value: 100,   label: '$1',   type: 'coin', color: 'hsl(45, 50%, 50%)' },
  { value: 50,    label: '50¢',  type: 'coin', color: 'hsl(220, 15%, 55%)' },
];

/** Format cents/centavos to display string */
export function format_currency(cents: number, locale: 'en' | 'es'): string {
  if (locale === 'es') {
    // MXN: no decimals for whole pesos
    if (cents % 100 === 0) return `$${cents / 100}`;
    return `$${(cents / 100).toFixed(2)}`;
  }
  return `$${(cents / 100).toFixed(2)}`;
}
