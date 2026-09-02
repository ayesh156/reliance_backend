
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

/**
 * Validate Sri Lankan Phone Numbers.
 * Supports:
 * - Domestic mobile: 07XXXXXXXX (10 digits starting with 070-078)
 * - Domestic landline: 0XXXXXXXXX (10 digits starting with area codes like 011, 081, etc.)
 * - International format: +947XXXXXXXX or +94XXXXXXXXX
 */
export const isValidSriLankanPhone = (phone: string): boolean => {
  const clean = phone.replace(/[\s-]/g, '');
  // Matches 0XXXXXXXXX (10 digits) or +94XXXXXXXXX (12 characters with +94)
  const phoneRegex = /^(?:0|(\+94))[1-9][0-9]{8}$/;
  return phoneRegex.test(clean);
};