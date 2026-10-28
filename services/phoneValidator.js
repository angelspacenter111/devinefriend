/**
 * Contact Number Validation & Normalization Service
 *
 * Requirements:
 * - Only numeric value accepted.
 * - Maximum 10 digits.
 * - Proper error messages without Dubai/UAE restrictions.
 */

function cleanPhoneNumber(input) {
  if (input === null || input === undefined) return '';
  return input.toString().trim().replace(/[\s\-\(\)\.]/g, '');
}

/**
 * Validates and extracts contact number details.
 * @param {string} input - Mobile / contact number string entered by user.
 * @returns {object} Validation result and search variants.
 */
function parseUAEMobile(input) {
  if (!input || !input.toString().trim()) {
    return {
      isValid: false,
      message: 'Please enter your contact number.'
    };
  }

  let str = cleanPhoneNumber(input);

  // If user entered legacy country code (+971, 00971, 971), strip it
  if (str.startsWith('+971')) {
    str = str.slice(4);
  } else if (str.startsWith('00971')) {
    str = str.slice(5);
  } else if (str.startsWith('971') && str.length >= 11) {
    str = str.slice(3);
  }

  // Only numbers allowed
  if (!/^\d+$/.test(str)) {
    return {
      isValid: false,
      message: 'Contact number must contain only numbers.'
    };
  }

  // Maximum 10 digits
  if (str.length > 10) {
    return {
      isValid: false,
      message: 'Contact number cannot exceed 10 digits.'
    };
  }

  // Build variants so existing accounts in DB can still be matched
  const allVariants = Array.from(new Set([
    str,
    input.toString().trim(),
    `+971 ${str.slice(0, 2)} ${str.slice(2, 5)} ${str.slice(5)}`.trim(),
    `+971${str}`,
    `0${str}`
  ]));

  return {
    isValid: true,
    digits: str,
    local: str,
    localFormatted: str,
    e164: str,
    formatted: str,
    internationalFormatted: str,
    allVariants,
    message: 'Valid contact number'
  };
}

/**
 * Quick boolean check if a number is a valid contact number.
 */
function isUAEMobile(input) {
  return parseUAEMobile(input).isValid;
}

/**
 * Returns canonical contact number or null.
 */
function normalizeUAEMobile(input) {
  const result = parseUAEMobile(input);
  return result.isValid ? result.formatted : null;
}

/**
 * Returns an array of search variants for MongoDB queries.
 */
function getUAEMobileVariants(input) {
  const result = parseUAEMobile(input);
  if (result.isValid) {
    return result.allVariants;
  }
  const raw = (input || '').toString().trim();
  return raw ? [raw] : [];
}

module.exports = {
  cleanPhoneNumber,
  parseUAEMobile,
  isUAEMobile,
  normalizeUAEMobile,
  getUAEMobileVariants
};
