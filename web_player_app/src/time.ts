export class Time {
    private seconds_: number;

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
        return this.seconds_ * 1000;
    }

    seconds(): number {
        return this.seconds_;
    }

    add(time: Time): Time {
        return new Time(this.seconds_ + time.seconds_);
    }
}

export interface Timerange {
    start: Time,
    end: Time
}

export class Duration {
    private seconds_: number;

    constructor(seconds: number) {
        this.seconds_ = seconds;
    }

    static fromMilliseconds(milliseconds: number): Duration {
        return new Duration(milliseconds / 1000);
    }

    static fromSeconds(seconds: number): Duration {
        return new Duration(seconds);
    }

    milliseconds(): number {
        return this.seconds_ * 1000;
    }

    seconds(): number {
        return this.seconds_;
    }

    add(duration: Duration): Duration {
        return new Duration(this.seconds_ + duration.seconds_);
    }

    subtract(duration: Duration): Duration {
        return new Duration(this.seconds_ - duration.seconds_);
    }
}
