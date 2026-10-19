export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  constructor(private currentDate: Date) {}

  now(): Date {
    return new Date(this.currentDate.getTime());
  }

  setCurrentDate(date: Date): void {
    this.currentDate = date;
  }
}

export const CLOCK_PORT = Symbol('CLOCK_PORT');
