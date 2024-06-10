import { mount, querySelector } from "./dom";
import { clamp } from "./math";
import { Optional } from "./optional";
import { Result } from "./result";

type SliderCallback = (ratio: number) => void;
type SlideHandler = (event: MouseEvent, callback: Optional<SliderCallback>) => number;

export interface Slider {
    isSliding: boolean;
    root: HTMLDivElement;
    scrubber: HTMLDivElement;
    input: HTMLInputElement;
}

export interface SliderHandlers {
    onSlide: Optional<SliderCallback>;
    onSlideStart: Optional<SliderCallback>;
    onSlideEnd: Optional<SliderCallback>;
}

export function mountSlider(
    selector: string,
    handlers: SliderHandlers
): Result<Slider, string> {
    return mount(createSlider, addSliderHandlers)(selector, handlers);
}

export function repositionSlider(slider: Slider, position: number) {
    slider.scrubber.style.left = `${clamp(position * 100, 0, 100)}%`;
}

export function createSlider(rootSelector: string): Result<Slider, string> {
    const root = querySelector<HTMLDivElement>(document, rootSelector);

    if (root.none()) {
        return Result.error(`Couldn't find root with id ${rootSelector}`);
    }

    const scrubber = querySelector<HTMLDivElement>(root.unwrap(), ".scrubber");
    const input = querySelector<HTMLInputElement>(root.unwrap(), ".slider-input");

    if (scrubber.none()) {
        return Result.error("No scrubber found");
    }

    if (input.none()) {
        return Result.error("No input found");
    }

    return Result.ok({
        root: root.unwrap(),
        scrubber: scrubber.unwrap(),
        input: input.unwrap(),
        isSliding: false
    });
}

export function addSliderHandlers(
    slider: Slider,
    handlers: SliderHandlers
): Result<boolean, string> {
    const slideHandler = createSlideHandler(slider);
    slider.root.addEventListener("click", (event) => slideHandler(event, handlers.onSlide));
    slider.root.addEventListener("mousedown", (event) => {
        const onMouseMove = (event: MouseEvent) => slideHandler(event, handlers.onSlide);
        event.preventDefault();
        slider.isSliding = true;
        slideHandler(event, handlers.onSlideStart);
        document.addEventListener("mousemove", onMouseMove);

        document.addEventListener("mouseup", (event) => {
            event.preventDefault();
            slider.isSliding = false;
            slideHandler(event, handlers.onSlideEnd);
            document.removeEventListener("mousemove", onMouseMove);
        }, {
            once: true
        });
    });

    return Result.ok(true);
}

function createSlideHandler(slider: Slider): SlideHandler {
    return (event: MouseEvent, callback: Optional<SliderCallback>) => {
        const containerBoundingRect = slider.root.getBoundingClientRect();
        const containerX = containerBoundingRect.x;
        const dX = event.clientX - containerX;
        const x = clamp(dX, 0, containerBoundingRect.width);
        const position = x / containerBoundingRect.width
        repositionSlider(slider, position);
        slider.input.value = position.toFixed(0);

        if (!callback.none()) {
            callback.unwrap()(position);
        }

        return position;
    };
}

