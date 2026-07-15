/**
 * Clock port.
 *
 * Abstraction over time source. Production uses `Date`; tests use a fixed clock.
 */

export interface Clock {
  /**
   * Returns the current UTC time.
   */
  now(): Date;
}
