export function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

export function random(min: number, max: number) {
    return Math.floor(Math.random() * max + min);
}
