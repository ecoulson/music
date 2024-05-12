import { HubClient } from "../generated/HubServiceClientPb";
import { StreamAudioRequest, StreamAudioResponse } from "../generated/hub_pb";

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

const service = new HubClient("http://10.0.0.142:8000");
const audioContext = new AudioContext();
const gainNode = audioContext.createGain();
const playbackController = expectElementWithId("playback-state");
const playbackScrubber = expectElementWithId("playback-scrubber");
const playbackScrubberControl = expectElementWithId("playback-scrubber-control");
const volumeControl = expectElementWithId("volume-control");
const volumeControlScrubber = expectElementWithId("volume-control-scrubber");

let nextTimeMs = 0;
let lastTimeMs = 0;
let nextChunkId = 0;
let idleChunks: AudioChunk[] = [];
let playbackState: PlaybackState = PlaybackState.Empty;
let durationMs = 0;
let volumeLevel = 1;

gainNode.connect(audioContext.destination);
playbackController.addEventListener("click", handlePlaybackState);
volumeControl.addEventListener("click", handleVolumeAdjustment);

function expectElementWithId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`failed to retrieve element with id ${id}`);
    }

    return element as T;
}

function handleVolumeAdjustment(event: MouseEvent) {
    volumeLevel = event.clientX / volumeControl.clientWidth;
    console.log(volumeLevel);
    gainNode.gain.setValueAtTime(volumeLevel, audioContext.currentTime);
    volumeControlScrubber.style.left = `${event.clientX}px`;
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
    let amountPlayedSec = audioContext.getOutputTimestamp().contextTime;

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

    playbackScrubberControl.style.left = `${(width * progress).toFixed(0)}px`;

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

