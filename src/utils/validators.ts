
/**
 * Validate Sri Lankan National Identity Card (NIC) numbers.
 * Supports:
 * - Old format: 9 digits followed by 'V' or 'X' (e.g., 901234567V)
 * - New format: 12 digits (e.g., 199012345678)
 */
export const isValidSriLankanNIC = (nic: string): boolean => {
  const clean = nic.trim().toUpperCase();
  const oldNicRegex = /^[0-9]{9}[VX]$/;
  const newNicRegex = /^[0-9]{12}$/;
  return oldNicRegex.test(clean) || newNicRegex.test(clean);
};


export const isValidSriLankanPhone = (phone: string): boolean => {
  const clean = phone.replace(/[\s-]/g, '');
  // Matches 0XXXXXXXXX (10 digits) or +94XXXXXXXXX (12 characters with +94)
  const phoneRegex = /^(?:0|(\+94))[1-9][0-9]{8}$/;
  return phoneRegex.test(clean);
};

/**
 * Backend Database Protection: Sanitize Numeric Financial & Inventory Values
 * සෘණ අගයන් සහ NaN මඟින් Database දෝෂ ඇතිවීම වළක්වයි
 */
export const sanitizeSafePrice = (val: any): number => {
  const num = Number(val);
  return isNaN(num) || num < 0 ? 0 : Math.round(num * 100) / 100;
};

export const sanitizeSafeStock = (val: any): number => {
  const num = parseInt(String(val), 10);
  return isNaN(num) || num < 0 ? 0 : num;
};

/**
 * Server-side Product Payload Hardening
 */
export const validateProductPayload = (
  name: any,
  categoryId: any
): { isValid: boolean; message?: string } => {
  if (typeof name !== 'string' || !name.trim()) {
    return { isValid: false, message: 'Product title is required and cannot be blank' };
  }
  if (name.trim().length < 2 || name.trim().length > 200) {
    return { isValid: false, message: 'Product title must be between 2 and 200 characters' };
  }
  const parsedCatId = Number(categoryId);
  if (isNaN(parsedCatId) || parsedCatId <= 0) {
    return { isValid: false, message: 'A valid positive integer categoryId is required' };
  }
  return { isValid: true };
};