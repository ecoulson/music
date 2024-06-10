export class Optional<T> {
    private value: T | null;

    constructor() {
        this.value = null;
    }

    static of<T>(value: T) {
        let optional = new Optional<T>();
        optional.value = value;
        return optional;
    }

    static empty() {
        return new Optional<any>();
    }

    unwrap(): T {
        if (!this.value) {
            throw new Error("Unwrap optional");
        }

        return this.value;
    }

    unwrap_or(other: T): T {
        if (!this.value) {
            return other;
        }

        return this.value;
    }

    some(): boolean {
        return this.value != null;
    }

    none(): boolean {
        return this.value == null;
    }
}
