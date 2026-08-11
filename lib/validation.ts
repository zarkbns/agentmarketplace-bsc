import { isAddress, isHex } from "viem";

/**
 * Address & input validation helpers shared across the backend.
 * Never trust addresses, amounts or transaction data supplied by the browser.
 */

export function requireAddress(value: unknown, field = "address"): `0x${string}` {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`${field} must be a valid EVM address.`);
  }
  return value as `0x${string}`;
}

export function requireHex(value: unknown, field = "value"): `0x${string}` {
  if (typeof value !== "string" || !isHex(value)) {
    throw new Error(`${field} must be a valid 0x-hex string.`);
  }
  return value as `0x${string}`;
}

/**
 * Parse a human-supplied amount. Accepts decimal strings ("0.5") with at most
 * `decimals` fractional digits. Returns the raw integer units as a string.
 */
export function parseAmount(value: unknown, decimals = 18, field = "amount"): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${field} must be a number.`);
  }
  const text = String(value).trim();
  const re = new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!re.test(text)) {
    throw new Error(`${field} must be a positive number with at most ${decimals} decimal places.`);
  }
  const [whole, fraction = ""] = text.split(".");
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units <= 0n) throw new Error(`${field} must be greater than zero.`);
  return units.toString();
}

/** Validate a chain id is one of the chains this marketplace supports. */
export function requireChainId(value: unknown, supported: number[], field = "chainId"): number {
  const chainId = Number(value);
  if (!Number.isInteger(chainId) || !supported.includes(chainId)) {
    throw new Error(`${field} must be one of: ${supported.join(", ")}.`);
  }
  return chainId;
}

/** Cheap validation for agent task text. */
export function requireTask(value: unknown, maxLength = 2000): string {
  if (typeof value !== "string") throw new Error("task must be a string.");
  const task = value.trim();
  if (task.length < 10) throw new Error("task must be at least 10 characters.");
  if (task.length > maxLength) throw new Error(`task must be at most ${maxLength} characters.`);
  return task;
}
