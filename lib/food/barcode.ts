// Barcodes as typed or scanned → the 13-digit GTIN that FatSecret wants and Open
// Food Facts understands. UPC-A (12), EAN-13, EAN-8, UPC-E (6–8) and GTIN-14
// with a leading 0 are all accepted; the check digit must add up, so a typo
// gets "check the digits" rather than someone else's product.

/** GS1 check: the last digit makes the weighted sum a multiple of 10. */
export function checkDigitOk(code: string): boolean {
  if (!/^\d{8,14}$/.test(code)) return false;
  return computeCheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** The check digit for the digits before it. */
export function computeCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    // Weights 3,1,3,1… from the rightmost body digit.
    const weight = (body.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** UPC-E (number system, six digits, check) → UPC-A (12 digits). */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0];
  const d = code.slice(1, 7);
  const check = code[7];
  const last = d[5];
  let body: string;
  if (last <= '2') body = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === '3') body = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === '4') body = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else body = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`;
  return `${ns}${body}${check}`;
}

/** The GTIN-13 for whatever was typed or scanned, or null if it isn't a valid barcode. */
export function toGtin13(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const digits = String(input).replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 14) return digits.startsWith('0') && checkDigitOk(digits) ? digits.slice(1) : null;
  if (digits.length === 13 || digits.length === 12) return checkDigitOk(digits) ? digits.padStart(13, '0') : null;
  if (digits.length === 8) {
    if (checkDigitOk(digits)) return digits.padStart(13, '0'); // EAN-8
    const upcA = expandUpcE(digits);
    return upcA && checkDigitOk(upcA) ? upcA.padStart(13, '0') : null;
  }
  if (digits.length === 7 || digits.length === 6) {
    // UPC-E printed without its number system (assume 0) and/or check digit.
    const withNs = digits.length === 6 ? `0${digits}` : digits;
    const upcA = expandUpcE(`${withNs}0`);
    if (!upcA) return null;
    const body = upcA.slice(0, 11);
    return `${body}${computeCheckDigit(body)}`.padStart(13, '0');
  }
  return null;
}

/** The forms to try with a service that might have stored the 12-digit UPC-A or the 13-digit GTIN. */
export function barcodeVariants(gtin13: string): string[] {
  return gtin13.startsWith('0') ? [gtin13, gtin13.slice(1)] : [gtin13];
}
