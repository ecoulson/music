export interface Tape<T> {
    buffer: T[],
    head: number,
    leftPointer: number,
    rightPointer: number,
}

export function createTape<T>(bufferSize: number): Tape<T> {
    let buffer: T[] = new Array(bufferSize);
    buffer.fill(undefined as T);
    Object.seal(buffer);

    return {
        buffer,
        head: 0,
        leftPointer: 0,
        rightPointer: 0,
    }
}

export function shiftLeft<T>(tape: Tape<T>, newLeft: T): void {
    if (size(tape) == tape.buffer.length - 1) {
        tape.rightPointer = (tape.rightPointer - 1) % tape.buffer.length;
    }

    tape.leftPointer = (tape.leftPointer - 1) % tape.buffer.length;
    tape.head = (tape.head - 1) % tape.buffer.length;
    tape.buffer[tape.leftPointer] = newLeft;
}

export function shiftRight<T>(tape: Tape<T>, newRight: T): void {
    if (size(tape) == tape.buffer.length - 1) {
        tape.leftPointer = (tape.leftPointer + 1) % tape.buffer.length;
    }

    tape.rightPointer = (tape.rightPointer + 1) % tape.buffer.length;
    tape.head = (tape.head + 1) % tape.buffer.length;
    tape.buffer[tape.rightPointer] = newRight;
}

export function read<T>(tape: Tape<T>): T {
    return tape.buffer[tape.head];
}

export function write<T>(tape: Tape<T>, value: T): void {
    if (tape.head == tape.rightPointer) {
        tape.rightPointer++;
    }

    tape.buffer[tape.head] = value;
}

export function size<T>(tape: Tape<T>): number {
    return (tape.rightPointer - tape.leftPointer) % tape.buffer.length;
}

export function capacity<T>(tape: Tape<T>): number {
    return tape.buffer.length;
}

export function isEmpty<T>(tape: Tape<T>): boolean {
    return size(tape) == 0;
}

export function sliceRight<T>(tape: Tape<T>): T[] {
    const slice = [];

    for (let i = tape.head; i != tape.rightPointer; i = (i + 1) % tape.buffer.length) {
        slice.push(tape.buffer[i]);
    }

    return slice;
}

