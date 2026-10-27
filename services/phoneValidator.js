/**
 * UAE / Dubai Mobile Number Validation & Normalization Service
 *
 * Requirements:
 * - Dubai / UAE mobile numbers only.
 * - Country code: +971.
 * - UAE Mobile operator prefixes:
 *     Etisalat (e&): 050, 054, 056
 *     du: 052, 055, 058
 *     Virgin Mobile: 058
 * - Total digits: 9 digits excluding country code / national leading 0.
 *   (e.g., 50 123 4567 or 050 123 4567 or +971 50 123 4567)
 */

function cleanPhoneNumber(input) {
  if (input === null || input === undefined) return '';
  return input.toString().trim().replace(/[\s\-\(\)\.]/g, '');
}

/**
 * Validates and extracts UAE mobile number details.
 * @param {string} input - Mobile number string entered by user.
 * @returns {object} Validation result and formatted variants.
 */
function parseUAEMobile(input) {
  if (!input || !input.toString().trim()) {
    return {
      isValid: false,
      message: 'Mobile number is required.'
    };
  }

  let str = cleanPhoneNumber(input);

  // Strip international country code if present (+971, 00971, 971)
  if (str.startsWith('+971')) {
    str = str.slice(4);
  } else if (str.startsWith('00971')) {
    str = str.slice(5);
  } else if (str.startsWith('971') && str.length >= 11) {
    str = str.slice(3);
  }

  // Remove leading 0 if present (e.g., 0501234567 -> 501234567)
  if (str.startsWith('0')) {
    str = str.slice(1);
  }

  // UAE mobile numbers must be 9 digits starting with 5, followed by valid telecom operator code:
  // 50, 52, 54, 55, 56, 58 (Etisalat, du, Virgin Mobile)
  const uaeMobileRegex = /^5[024568]\d{7}$/;

  if (!uaeMobileRegex.test(str)) {
    return {
      isValid: false,
      message: 'Please enter a valid Dubai / UAE mobile number (e.g. 050 123 4567 or 50 123 4567). Allowed prefixes: 050, 052, 054, 055, 056, 058.'
    };
  }

  const op = str.slice(0, 2);
  const part1 = str.slice(2, 5);
  const part2 = str.slice(5);

  const formattedDisplay = `+971 ${op} ${part1} ${part2}`;
  const localFormatted = `0${op} ${part1} ${part2}`;
  const localRaw = `0${str}`;
  const e164 = `+971${str}`;

  // All possible representations in database to allow seamless login and duplicate prevention
  const allVariants = Array.from(new Set([
    formattedDisplay,
    e164,
    `00971${str}`,
    `971${str}`,
    `971 ${op} ${part1} ${part2}`,
    localFormatted,
    localRaw,
    str,
    `${op} ${part1} ${part2}`,
    input.toString().trim()
  ]));

  return {
    isValid: true,
    digits: str,
    local: localRaw,
    localFormatted,
    e164,
    formatted: formattedDisplay,
    internationalFormatted: formattedDisplay,
    allVariants
  };
}

/**
 * Quick boolean check if a number is a valid UAE mobile number.
 */
function isUAEMobile(input) {
  return parseUAEMobile(input).isValid;
}

/**
 * Returns canonical formatted UAE number or null.
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
