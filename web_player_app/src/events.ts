import { random } from "./math";

type EventMap = Record<string, any>

export type EventKey<T extends EventMap> = string & keyof T;
type EventHandler<T> = (event: T) => void;

export interface EventListener<T> {
    id: number,
    handler: EventHandler<T>
}

export class Emitter<T extends EventMap> {
    private singleUse: Set<EventListener<any>>;
    private listenersByEvent: {
        [K in keyof EventMap]?: Array<EventListener<EventMap[K]>>
    }

    constructor() {
        this.listenersByEvent = {};
        this.singleUse = new Set();
    }

    private createListener<T>(handler: EventHandler<T>): EventListener<T> {
        return {
            id: random(0, Number.MAX_SAFE_INTEGER),
            handler
        };
    }

    on<K extends EventKey<T>>(key: K, handler: EventHandler<T[K]>): EventListener<T[K]> {
        if (!(key in this.listenersByEvent)) {
            this.listenersByEvent[key] = [];
        }

        let listener = this.createListener(handler);
        this.listenersByEvent[key]!.push(listener);

        return listener;
    }

    once<K extends EventKey<T>>(key: K, handler: EventHandler<T[K]>): EventListener<T[K]> {
        if (!(key in this.listenersByEvent)) {
            this.listenersByEvent[key] = [];
        }

        let listener = this.createListener(handler);
        this.listenersByEvent[key]!.push(listener);
        this.singleUse.add(listener);

        return listener;
    }

    // Returns number of handlers removed
    off<K extends EventKey<T>>(key: K, listener: EventListener<T[K]>): number {
        if (!(key in this.listenersByEvent)) {
            this.listenersByEvent[key] = [];
        }

        const originalSize = this.listenersByEvent[key]!.length;
        this.listenersByEvent[key] = this.listenersByEvent[key]!
            .filter((other) => listener.id != other.id);

        return originalSize - this.listenersByEvent[key]!.length;
    }

    // Returns number of event emitted
    emit<K extends EventKey<T>>(key: K, event: T[K]): number {
        if (!(key in this.listenersByEvent)) {
            return 0;
        }

        let eventsEmitted = 0;

        for (const listener of this.listenersByEvent[key]!) {
            listener.handler(event);
            eventsEmitted++;

            if (this.singleUse.has(listener)) {
                this.off(key, listener);
            }
        }

        return eventsEmitted;
    }
}

