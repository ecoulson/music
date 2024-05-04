import { HubClient } from "../generated/HubServiceClientPb";
import { StreamAudioRequest, StreamAudioResponse } from "../generated/hub_pb";

enum PlaybackState {
    Paused,
    Playing,
    Empty
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
const request = new StreamAudioRequest();
const audioContext = new AudioContext();
const playbackController = document.getElementById("playback-controller");
const playbackState: PlaybackState = PlaybackState.Empty;

let nextTimeMs = 0;
let lastTimeMs = 0;
let nextChunkId = 0;
let idleChunks: AudioChunk[] = [];

function loadSong() {
    const playbackSongId: HTMLInputElement | null = document.getElementById("playback-song-id") as HTMLInputElement;

    if (playbackSongId) {
        console.log("Request song id", playbackSongId.value);
        const stream = service.streamAudio(request, {});
        stream.on('data', function(response: StreamAudioResponse) {
            let chunk = response.getChunk_asU8();
            audioContext.decodeAudioData(chunk.buffer, (buffer) => addToBuffer(buffer, response))
        });
    }
}

function controlPlayback() {
    switch (playbackState) {
        case PlaybackState.Paused:
            resumse();
            break;
        case PlaybackState.Playing:
            pause();
            break;
        case PlaybackState.Empty:
            loadSong();
            break;
        default:
            console.log("Unhandled playback state");
            break;
    }
}

function pause() {
    audioContext.suspend();
}

function resumse() {
    audioContext.resume();
}

function scheduleAudioBuffer(audioChunk: AudioChunk) {
    const audioBufferSource = audioContext.createBufferSource();
    audioBufferSource.connect(audioContext.destination);
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

if (!playbackController) {
    console.error("Couldn't find playback controller");
}

playbackController?.addEventListener("click", controlPlayback);
