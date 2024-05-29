export class Time {
    seconds_: number;

    constructor(seconds: number) {
        this.seconds_ = seconds;
    }

    static fromUnixMilliseconds(milliseconds: number): Time {
        return new Time(milliseconds / 1000);
    }

    static fromUnixSeconds(seconds: number): Time {
        return new Time(seconds);
    }

    static nowUtc(): Time {
        return new Time(new Date().getTime() / 1000);
    }

    milliseconds(): number {
        return Math.floor(this.seconds_ * 1000);
    }
}

export interface Timerange {
    start: Time,
    end: Time
}

export class Duration {
    seconds_: number;

    constructor(seconds: number) {
        this.seconds_ = seconds;
    }

    static fromMilliseconds(milliseconds: number): Time {
        return new Time(milliseconds / 1000);
    }

    static fromSeconds(seconds: number): Time {
        return new Time(seconds);
    }

    milliseconds(): number {
        return Math.floor(this.seconds_ * 1000);
    }
}
