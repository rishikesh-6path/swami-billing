const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] ?? '');
    n %= 10;
  }
  if (n > 0) parts.push(ONES[n] ?? '');
  return parts.join(' ');
}

/** Whole number in the Indian system: 1,23,45,678 -> "One Crore Twenty Three Lakh ...". */
function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** 118050 paise -> "Rupees One Thousand One Hundred Eighty and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0)
    throw new RangeError('Amount in words needs a non-negative whole number of paise');
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  const rupeePart = `Rupees ${indianWords(rupees)}`;
  return rest === 0 ? `${rupeePart} Only` : `${rupeePart} and ${indianWords(rest)} Paise Only`;
}
