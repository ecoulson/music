import { HubClient } from "../generated/HubServiceClientPb";
import { StreamAudioRequest, StreamAudioResponse } from "../generated/hub_pb";

type SliderCallback = (ratio: number) => void;

enum PlaybackState {
    Paused,
    Playing,
    Loading,
    Empty,
    Error,
    Complete,
}

class AudioChunk {
    buffer: AudioBuffer;
    chunkId: number;

    constructor(chunkId: number, buffer: AudioBuffer) {
        this.chunkId = chunkId;
        this.buffer = buffer;
    }
}

class Optional<T> {
    value: T | null;

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

    isEmpty(): boolean {
        return this.value == null;
    }
}

class Result<T, E> {
    value: T | null;
    error: E | null;

    constructor() {
        this.value = null;
        this.error = null
    };

    static ok<T>(value: T): Result<T, any> {
        let result = new Result<T, any>();
        result.value = value;
        return result;
    }

    static error<E>(error: E): Result<any, E> {
        let result = new Result<any, E>();
        result.error = error;
        return result;
    }

    unwrap(): T {
        if (!this.value) {
            throw new Error("Unwrapped empty result");
        }

        return this.value;
    }
}

class Slider {
    container: HTMLDivElement;
    scrubber: HTMLDivElement;
    input: HTMLInputElement;

    constructor(
        container: HTMLDivElement,
        scrubber: HTMLDivElement,
        input: HTMLInputElement,
    ) {
        this.scrubber = scrubber;
        this.container = container;
        this.input = input;
    }
}

const service = new HubClient("http://localhost:8000");
const audioContext = new AudioContext();
const gainNode = audioContext.createGain();
const playbackController = expectElementWithId("playback-state");
const playbackScrubber = expectElementWithId("playback-scrubber");
const playbackScrubberControl = expectElementWithId("playback-scrubber-control");

let nextTimeMs = 0;
let lastTimeMs = 0;
let nextChunkId = 0;
let idleChunks: AudioChunk[] = [];
let playbackState: PlaybackState = PlaybackState.Empty;
let durationMs = 0;
let isScrubbing = false

gainNode.connect(audioContext.destination);
playbackController.addEventListener("click", handlePlaybackState);

createSlider(
    "playback-scrubber",
    Optional.of(handlePlaybackSlide),
    Optional.of(handlePlaybackSlideStart),
    Optional.of(handlePlaybackSlideEnd)
).unwrap();
createSlider("volume-control", Optional.of(handleVolumeSlide)).unwrap();

function handlePlaybackSlide(value: number) {
    console.log(`Playback is scrubbed: ${(value * 100).toFixed(0)}%`);
}

function handlePlaybackSlideStart() {
    isScrubbing = true;
}

function handlePlaybackSlideEnd() {
    isScrubbing = false;
}

function handleVolumeSlide(volumeLevel: number) {
    gainNode.gain.setValueAtTime(volumeLevel, audioContext.currentTime);
}

function createSlider(
    containerId: string,
    onSlide: Optional<SliderCallback> = Optional.empty(),
    onSlideStart: Optional<SliderCallback> = Optional.empty(),
    onSlideEnd: Optional<SliderCallback> = Optional.empty()
): Result<Slider, string> {
    const container = expectElementWithId<HTMLDivElement>(containerId);
    const scrubber = container.getElementsByClassName("scrubber").item(0);
    const input = container.getElementsByClassName("slider-input").item(0);

    if (!scrubber) {
        return Result.error("No scrubber found");
    }

    if (!input) {
        return Result.error("No input found");
    }

    const slider = new Slider(container, scrubber as HTMLDivElement, input as HTMLInputElement);
    slider.scrubber.style.left = `${slider.input.value}%`;
    container.addEventListener("mousedown", (event) => {
        const mouseMoveHandler = (event: MouseEvent) => {
            const position = moveSlider(event, slider);

            if (!onSlide.isEmpty()) {
                onSlide.unwrap()(position);
            }
        }

        if (!onSlideStart.isEmpty()) {
            onSlideStart.unwrap()(moveSlider(event, slider));
        }

        document.addEventListener("mousemove", mouseMoveHandler);
        document.addEventListener("mouseup", (event) => {
            if (!onSlideEnd.isEmpty()) {
                onSlideEnd.unwrap()(moveSlider(event, slider))
            }

            document.removeEventListener("mousemove", mouseMoveHandler);
        }, {
            once: true
        });
    });

    return Result.ok(slider);
}

function expectElementWithId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`failed to retrieve element with id ${id}`);
    }

    return element as T;
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function moveSlider(
    event: MouseEvent,
    slider: Slider,
): number {
    const containerX = slider.container.getBoundingClientRect().x;
    const x = clamp(event.clientX - containerX, 0, slider.container.getBoundingClientRect().width);
    slider.scrubber.style.left = `${x}px`;
    slider.input.value = (x / slider.container.getBoundingClientRect().width).toString();

    return x / slider.container.getBoundingClientRect().width;
}

function handlePlaybackTick(): PlaybackState {
    if (!playbackScrubber) {
        console.error("Playback scrubber not found");
        return PlaybackState.Error;
    }

    if (!playbackScrubberControl) {
        console.error("Playback scrubber control not found");
        return PlaybackState.Error;
    }

    if (playbackState != PlaybackState.Playing) {
        return playbackState;
    }

    let width = playbackScrubber.clientWidth;
    let amountPlayedSec = audioContext.currentTime;

    if (!amountPlayedSec) {
        console.error("Couldn't retreive context time");
        return PlaybackState.Error;
    }

    let progress = amountPlayedSec * 1000 / durationMs;

    if (isNaN(progress) || !isFinite(progress)) {
        console.error("Playback being handled before audio loaded");
        return PlaybackState.Error;
    }

    if (progress >= 1) {
        return PlaybackState.Complete;
    }

    if (!isScrubbing) {
        playbackScrubberControl.style.left = `${width * progress}px`;
    }

    return PlaybackState.Playing;
}

function loadTrackAudio(trackId: string) {
    const request = new StreamAudioRequest();
    request.setTrackId(trackId);
    const stream = service.streamAudio(request, {});

    audioContext.addEventListener("statechange", () => {
        const stateElement = document.getElementById("playback-state");

        if (!stateElement) {
            console.error("Failed to get playback state component");
            return;
        }

        switch (audioContext.state) {
            case "running":
                playbackState = PlaybackState.Playing;
                stateElement.textContent = "Play";
                break;
            case "suspended":
                playbackState = PlaybackState.Paused;
                stateElement.textContent = "Paused";
                break;
            case "closed":
                playbackState = PlaybackState.Complete;
                stateElement.textContent = "Done";
                break;
        }
    });

    stream.on('data', function(response: StreamAudioResponse) {
        let chunk = response.getChunk_asU8();
        audioContext.decodeAudioData(chunk.buffer, (buffer) => addToBuffer(buffer, response))
    });
}

function startAudioPlaybackMonitoring() {
    const intervalId = setInterval(() => {
        switch (handlePlaybackTick()) {
            case PlaybackState.Error:
            case PlaybackState.Complete:
                clearInterval(intervalId);
                break;
            default:
                break;
        }
    }, 100);
}

function handlePlaybackState() {
    const stateElement = document.getElementById("playback-state");
    const trackIdInput: HTMLInputElement = document.getElementById("playback-track-id") as HTMLInputElement;

    if (!stateElement) {
        console.error("Failed to get playback state component");
        return;
    }

    if (!trackIdInput) {
        console.error("Failed to get track id");
        return;
    }

    switch (playbackState) {
        case PlaybackState.Paused:
            audioContext.resume();
            break;
        case PlaybackState.Playing:
            audioContext.suspend();
            break;
        case PlaybackState.Empty:
            stateElement.textContent = "Pause";
            playbackState = PlaybackState.Loading;
            loadTrackAudio(trackIdInput.value);
            startAudioPlaybackMonitoring();
            break;
        case PlaybackState.Loading:
            break;
        default:
            console.error("Unhandled playback state");
            break;
    }
}

function scheduleAudioBuffer(audioChunk: AudioChunk) {
    const audioBufferSource = audioContext.createBufferSource();
    audioBufferSource.connect(gainNode);
    audioBufferSource.buffer = audioChunk.buffer;
    audioBufferSource.loop = false;

    setTimeout(() => {
        audioBufferSource.start();
        let currentMs = new Date().getTime();

        if (lastTimeMs == 0) {
            lastTimeMs = currentMs;
        }

        console.log(`Starting next buffer: Chunk ${audioChunk.chunkId}`);
        console.log(`Delta (s): ${(currentMs - lastTimeMs) / 1000.0}`);
        console.log(`Buffer duration ${audioChunk.buffer.duration}s`);
        lastTimeMs = currentMs;
    }, nextTimeMs);

    console.log(`Scheduling a buffer for ${(nextTimeMs / 1000)}s`);
    nextTimeMs += audioChunk.buffer.duration * 1000;
    durationMs += audioChunk.buffer.duration * 1000;
    nextChunkId += 1;
}

function addToBuffer(buffer: AudioBuffer, response: StreamAudioResponse) {
    const audioChunk = new AudioChunk(response.getChunkId(), buffer);

    if (nextChunkId == response.getChunkId()) {
        scheduleAudioBuffer(audioChunk);
    } else {
        let inserted = false;

        for (let i = 0; i < idleChunks.length; i++) {
            if (response.getChunkId() < idleChunks[i].chunkId) {
                idleChunks.splice(i, 0, audioChunk);
                inserted = true;
                break;
            }
        }

        if (!inserted) {
            idleChunks.push(audioChunk);
        }
    }

    while (idleChunks.length > 0 && idleChunks[0].chunkId == nextChunkId) {
        scheduleAudioBuffer(idleChunks.shift()!);
    }
}

