import { Optional } from "./optional";
import { Result } from "./result";

interface HtmxEvent<T> extends Event {
    detail: T & {
        elt: HTMLElement
    }
}

type ComponentConstructor<C> = (selector: string) => Result<C, string>;
type HandlerConstructor<C, H> = (component: C, handlers: H) => Result<boolean, string>;
type Mounter<C, H> = (selector: string, handlers: H) => Result<C, string>;

export function mount<C, H>(
    componentConstructor: ComponentConstructor<C>,
    handlerConstructor: HandlerConstructor<C, H>
): Mounter<C, H> {
    return (selector: string, handlers: H) => {
        const component = componentConstructor(selector);

        if (!component.ok()) {
            return Result.error(component.error());
        }

        return handlerConstructor(component.value(), handlers).map<C>(() => component.value());
    }
}

export function addHtmxListener<T>(event: string, handler: (event: HtmxEvent<T>) => void) {
    document.addEventListener(event, (event) => handler(event as HtmxEvent<T>));
}

export function querySelector<T extends HTMLElement>(
    root: HTMLElement | Document,
    selector: string
): Optional<T> {
    const element = root.querySelector<T>(selector);

    if (!element) {
        return Optional.empty();
    }

    return Optional.of(element);
}

export function querySelectorAll<T extends HTMLElement>(
    root: HTMLElement | Document,
    selector: string
): Optional<NodeListOf<T>> {
    const element = root.querySelectorAll<T>(selector);

    if (!element) {
        return Optional.empty();
    }

    return Optional.of(element);
}
