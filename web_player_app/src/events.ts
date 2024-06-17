import { Result } from "./result";

type EventMap = Record<string, any>

type EventKey<T extends EventMap> = string & keyof T;
type EventHandler<T> = (event: T) => void;

export class Emitter<T extends EventMap> {
    private singleUse: Set<any>;
    private handlers: {
        [K in keyof EventMap]?: Array<(event: EventMap[K]) => void>
    }

    constructor() {
        this.handlers = {};
        this.singleUse = new Set();
    }

    // Returns number of handlers added
    on<K extends EventKey<T>>(key: K, handler: EventHandler<T[K]>): number {
        if (!(key in this.handlers)) {
            this.handlers[key] = [];
        }

        this.handlers[key]!.push(handler);

        return 1;
    }

    once<K extends EventKey<T>>(key: K, handler: EventHandler<T[K]>): number {
        if (!(key in this.handlers)) {
            this.handlers[key] = [];
        }

        this.handlers[key]!.push(handler);
        this.singleUse.add(handler);

        return 1;
    }

    // Returns number of handlers removed
    off<K extends EventKey<T>>(key: K, handler: EventHandler<T[K]>): number {
        if (!(key in this.handlers)) {
            this.handlers[key] = [];
        }

        const originalSize = this.handlers[key]!.length;
        this.handlers[key] = this.handlers[key]!.filter((other) => handler != other);

        return originalSize - this.handlers[key]!.length;
    }

    // Returns number of event emitted
    emit<K extends EventKey<T>>(key: K, event: T[K]): number {
        if (!(key in this.handlers)) {
            return 0;
        }

        let eventsEmitted = 0;

        for (const handler of this.handlers[key]!) {
            handler(event);
            eventsEmitted++;

            if (this.singleUse.has(handler)) {
                this.off(key, handler);
            }
        }

        return eventsEmitted;
    }
}

