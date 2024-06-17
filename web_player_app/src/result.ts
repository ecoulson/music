export class Result<T, E> {
    private value_: T | null;
    private error_: E | null;

    constructor(value: T | null = null, error: E | null = null) {
        this.value_ = value;
        this.error_ = error;
    };

    static ok<T>(value: T): Result<T, any> {
        return new Result<T, any>(value);
    }

    static error<E>(error: E): Result<any, E> {
        return new Result<any, E>(null, error);
    }

    unwrap(): T {
        if (!this.value_) {
            console.error(this.error_);
            throw new Error("Unwrapped empty result");
        }

        return this.value_;
    }

    isError(): boolean {
        return this.error_ != null;
    }

    ok(): boolean {
        return this.error_ == null && this.value_ != null;
    }

    value(): T {
        if (this.value_ == null) {
            throw new Error("Can't get value of result");
        }

        return this.value_;
    }

    error(): E {
        if (this.error_ == null) {
            throw new Error("Can't get value of result");
        }

        return this.error_;
    }

    map<V>(mapFunction: (value: T) => V): Result<V, E> {
        if (!this.value_) {
            return new Result<V, E>(null, this.error_);
        }

        return new Result(mapFunction(this.value_), this.error_);
    }
}
