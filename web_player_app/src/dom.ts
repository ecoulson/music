import { Result } from "./result";

export function expectElementWithId<T extends HTMLElement>(id: string): Result<T, string> {
    const element = document.getElementById(id);

    if (!element) {
        return Result.error(`failed to retrieve element with id ${id}`);
    }

    return Result.ok(element as T);
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

