import { HubClient } from "../generated/HubServiceClientPb";
import { StreamAudioRequest, StreamAudioResponse } from "../generated/hub_pb";
import { Result } from "./result";
import { Duration, Time, Timerange } from "./time";

export interface Track {
    trackId: string;
    duration: Duration;
    trackNodes: TrackNode[];
    scheduledTimeRange: Timerange;
}

interface TrackNode {
    audioBufferSourceNode: AudioBufferSourceNode;
    createdTime: Time;
    scheduledTime: Time;
    duration: Time;
}

interface AudioChunk {
    buffer: AudioBuffer;
    raw: ArrayBuffer;
    chunkId: number;
}

interface TrackLoader {
    audio: PlayerAudio;
    hubClient: HubClient;
}

interface PlayerAudio {
    context: AudioContext;
    gainNode: GainNode;
}

export function createTrackLoader(audio: PlayerAudio, hubClient: HubClient): TrackLoader {
    return {
        audio,
        hubClient,
    };
}

export function loadTrack(loader: TrackLoader, trackId: string): Promise<Result<Track, DOMException>> {
    const request = new StreamAudioRequest();
    request.setTrackId(trackId);
    const stream = loader.hubClient.streamAudio(request, {});

    return new Promise((resolve) => {
        const trackNodes: TrackNode[] = [];
        let idleChunks: StreamAudioResponse[] = [];
        let nextId = 0;
        let trackBuffer: ArrayBuffer = new Uint8Array(0);
        const audioBufferSource = loader.audio.context.createBufferSource();
        audioBufferSource.connect(loader.audio.gainNode);

        stream.on('data', async (audioChunk) => {
            if (audioChunk.getChunkId() == nextId) {
                scheduleAudioChunk(loader, trackBuffer, audioChunk);
            }

            idleChunks = insertChunk(audioChunk, idleChunks);

            while (idleChunks.length > 0 && idleChunks[0].getChunkId() == nextId) {
                scheduleAudioChunk(loader, trackBuffer, idleChunks.shift()!);
            }
        });
        stream.on('data', (response) => {
            loader.audio.context.decodeAudioData(response.getChunk_asU8().buffer, (buffer) => {
                const audioChunk = {
                    chunkId: response.getChunkId(),
                    buffer,
                    raw: response.getChunk_asU8().buffer
                };

                if (audioChunk.chunkId == trackNodes.length) {
                    trackNodes.push(scheduleTrackNode(loader, audioChunk, trackNodes));
                }

                idleChunks = insertChunk(audioChunk, idleChunks);

                while (idleChunks.length > 0 && idleChunks[0].chunkId == trackNodes.length) {
                    console.log(idleChunks[0].chunkId);
                    trackNodes.push(scheduleTrackNode(loader, idleChunks.shift()!, trackNodes));
                }
            }, (error) => resolve(Result.error(error)));
        }).on("end", function() {
            resolve(Result.ok({
                trackId: trackId,
                trackNodes,
                duration: Duration.fromSeconds(0),
                scheduledTimeRange: {
                    start: Time.fromUnixSeconds(0),
                    end: Time.fromUnixSeconds(0),
                }
            }));
        })
    });
}

function insertChunk(audioChunk: AudioChunk, idleChunks: AudioChunk[]): AudioChunk[] {
    let inserted = false;
    const newIdleChunks = [...idleChunks];

    for (let i = 0; i < newIdleChunks.length; i++) {
        if (audioChunk.chunkId < newIdleChunks[i].chunkId) {
            newIdleChunks.splice(i, 0, audioChunk);
            inserted = true;
            break;
        }
    }

    if (!inserted) {
        newIdleChunks.push(audioChunk);
    }

    return newIdleChunks;
}

function scheduleTrackNode(
    loader: TrackLoader,
    audioChunk: AudioChunk,
    trackNodes: TrackNode[]
): TrackNode {
    const audioBufferSource = loader.audio.context.createBufferSource();
    audioBufferSource.connect(loader.audio.gainNode);
    audioBufferSource.buffer = audioChunk.buffer;
    audioBufferSource.loop = false;
    let nextTimeMs = 0;

    if (trackNodes.length > 0) {
        let previousTrackNode = trackNodes[trackNodes.length - 1];
        /*
        let firstTrackNode = trackNodes[0];
        let startDelta =
            Date.now() - firstTrackNode.createdTime.milliseconds();
        nextTimeMs =
            previousTrackNode.duration.milliseconds() +
            previousTrackNode.scheduledTime.milliseconds() - startDelta;
        */
        previousTrackNode.audioBufferSourceNode.addEventListener("ended", () => {
            audioBufferSource.start();
        })
    } else {
        audioBufferSource.start();
    }

    /*
    setTimeout(() => {
        audioBufferSource.start();
        let currentMs = new Date().getTime();
        let lastTimeMs = 0;

        if (trackNodes.length == 0) {
            lastTimeMs = currentMs;
        } else {
            lastTimeMs = trackNodes[trackNodes.length - 1].scheduledTime.milliseconds();
        }

        console.log(`Starting next buffer: Chunk ${audioChunk.chunkId}`);
        console.log(`Delta (s): ${(currentMs - lastTimeMs) / 1000.0}`);
        console.log(`Buffer duration ${audioChunk.buffer.duration}s`);
    }, nextTimeMs);

    console.log(`Scheduling a buffer for ${(nextTimeMs / 1000)}s`);
    */

    return {
        duration: Duration.fromSeconds(audioChunk.buffer.duration),
        createdTime: Time.nowUtc(),
        scheduledTime: Time.fromUnixMilliseconds(nextTimeMs),
        audioBufferSourceNode: audioBufferSource
    }
}

function appendChunk(trackBuffer: ArrayBuffer, audioChunk: StreamAudioResponse): Uint8Array {
    const responseBuffer = audioChunk.getChunk_asU8();
    const buffer = new Uint8Array(trackBuffer.byteLength + responseBuffer.byteLength);
    const trackArray = new Uint8Array(trackBuffer);
    const chunkBuffer = new Uint8Array(responseBuffer);
    buffer.set(trackArray, 0);
    buffer.set(chunkBuffer, responseBuffer.byteLength);

    return buffer;
}

function scheduleAudioChunk(
    loader: TrackLoader,
    trackBuffer: ArrayBuffer,
    audioChunk: StreamAudioResponse
) {
    const newTrackBuffer = appendChunk(trackBuffer, audioChunk);

}

