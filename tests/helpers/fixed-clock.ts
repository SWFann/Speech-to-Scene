import type { Clock } from "../../src/application/ports/clock.js";

export class FixedClock implements Clock {
  private _fixedTime: Date;

  constructor(fixedTime: Date | string = "2026-07-13T10:00:00.000Z") {
    this._fixedTime = typeof fixedTime === "string" ? new Date(fixedTime) : fixedTime;
  }

  now(): Date {
    return this._fixedTime;
  }

  advance(milliseconds: number): void {
    this._fixedTime = new Date(this._fixedTime.getTime() + milliseconds);
  }
}
