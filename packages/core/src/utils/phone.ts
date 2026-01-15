import {
  type CountryCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js";

import { AppError } from "../errors";

export const normalizePhoneE164 = (
  value: string,
  defaultCountry: CountryCode = "US",
) => {
  const parsed = parsePhoneNumberFromString(value, {
    defaultCountry,
  });
  if (!parsed || !parsed.isValid()) {
    throw new AppError("Invalid phone number", {
      code: "INVALID_PHONE",
      status: 400,
      meta: { input: value },
    });
  }

  return parsed.number;
};
