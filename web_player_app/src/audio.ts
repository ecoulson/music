import { MPEGDecodedAudio, MPEGDecoderWebWorker } from "mpg123-decoder";
import { HubClient } from "../generated/hub.client";
import { StreamAudioRequest, StreamAudioResponse, Track } from "../generated/hub";
import { Result } from "./result";
import { Duration, Time, Timerange } from "./time";
import { Status, StatusCode } from "grpc-web";
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { Emitter } from "./events";
import { AudioOutput } from "./player";

export interface Audio {
    trackId: string;
    duration: Duration;
    segments: AudioSegment[];
    scheduledTimeRange: Timerange;
}

export interface AudioSegment {
    frameId: number;
    audioBufferSource: AudioBufferSourceNode;
    scheduledTime: Time;
    duration: Duration;
}

interface AudioFrame {
    buffer: AudioBuffer;
    frameId: number;
}

export interface AudioLoader {
    audio: PlayerAudio;
    emitter: AudioLoaderEmitter;
}

interface PlayerAudio {
    context: AudioContext;
    gainNode: GainNode;
}

interface CancelEvent {
    canceledTrack: Track
}

interface FrameEvent {
    frame: AudioFrame,
    track: Track
}

interface ErrorEvent {
    trackId: string,
    error: Status
}

class AudioLoaderEmitter {
    emitter: Emitter<{
        cancel: CancelEvent,
        frame: FrameEvent,
        error: ErrorEvent,
    }>;

    constructor() {
        this.emitter = new Emitter();
    }

    onCancel(trackId: string, handler: (event: CancelEvent) => void) {
        this.emitter.on("cancel", (event) => {
            if (trackId !== event.canceledTrack.track_id) {
                return;
            }

            handler(event);
        });
    }

    onFrame(trackId: string, handler: (event: FrameEvent) => void) {
        this.emitter.on("frame", (event) => {
            if (trackId !== event.track.track_id) {
                return;
            }

            handler(event);
        });
    }

    onError(trackId: string, handler: (event: ErrorEvent) => void) {
        this.emitter.on("error", (event) => {
            if (event.trackId !== trackId) {
                return;
            }

            handler(event);
        });
    }

    emitError(trackId: string, error: Status) {
        this.emitter.emit("error", {
            trackId,
            error
        });
    }

    emitFrame(track: Track, frame: AudioFrame) {
        this.emitter.emit("frame", {
            track,
            frame
        });
    }

    emitCancel(track: Track) {
        this.emitter.emit("cancel", {
            canceledTrack: track
        });
    }
}

export function playAudioSegment(audio: AudioSegment, offset: Duration) {
    audio.audioBufferSource.start(offset.seconds() + audio.scheduledTime.seconds());
}

export function createAudioLoader(audio: PlayerAudio): AudioLoader {
    return {
        audio,
        emitter: new AudioLoaderEmitter()
    };
}

export function cancelAudioLoad(audioLoader: AudioLoader, track: Track) {
    audioLoader.emitter.emitCancel(track);
}

export function loadAudioForTrack(
    audioLoader: AudioLoader,
    track: Track,
    onSegment: (segment: AudioSegment) => void
): Promise<Result<Audio, Status>> {
    return new Promise(async (resolve) => {
        const abortController = new AbortController();
        const audioSegments: AudioSegment[] = [];
        const trackDuration = Duration.fromMilliseconds(track.duration_milliseconds);
        let idleFrames: AudioFrame[] = [];

        // TODO(MEMORY LEAK): Need to clean up these listeners at somepoint otherwise we leak memory
        // essentially
        audioLoader.emitter.onError(track.track_id, (event) => {
            abortController.abort();

            for (const segment of audioSegments) {
                segment.audioBufferSource.disconnect();
            }

            return resolve(Result.error(event.error));
        });
        audioLoader.emitter.onCancel(track.track_id, () => {
            abortController.abort();

            for (const segment of audioSegments) {
                segment.audioBufferSource.disconnect();
            }

            return resolve(Result.error({
                code: StatusCode.CANCELLED,
                details: "Audio load canceled"
            }))
        });
        audioLoader.emitter.onFrame(track.track_id, (event) => handleFrame(
            audioLoader, event, idleFrames, audioSegments, onSegment, abortController.signal));

        const decodingTasks = await requestAudioFrames(audioLoader, track, abortController.signal);

        if (decodingTasks.isError()) {
            return resolve(Result.error(decodingTasks.error()));
        }

        await Promise.all(decodingTasks.value());

        return resolve(Result.ok({
            trackId: track.track_id,
            segments: audioSegments,
            duration: trackDuration,
            scheduledTimeRange: {
                start: Time.fromUnixSeconds(0),
                end: Time.fromUnixSeconds(trackDuration.seconds()),
            }
        }));
    });
}

function handleFrame(
    audioLoader: AudioLoader,
    event: FrameEvent,
    idleFrames: AudioFrame[],
    audioSegments: AudioSegment[],
    onSegment: (segment: AudioSegment) => void,
    abortSignal: AbortSignal
) {
    if (abortSignal.aborted) {
        return;
    }

    if (event.frame.frameId == audioSegments.length) {
        const segment = createAudioSegment(audioLoader.audio, event.frame, audioSegments);
        onSegment(segment);
        audioSegments.push(segment);
        return;
    }

    idleFrames = insertIdleFrame(event.frame, idleFrames);

    while (idleFrames.length > 0 && idleFrames[0].frameId == audioSegments.length) {
        const segment = createAudioSegment(
            audioLoader.audio,
            idleFrames.shift()!,
            audioSegments
        );
        onSegment(segment);
        audioSegments.push(segment);
    }
}

function requestAudioFrames(
    audioLoader: AudioLoader,
    track: Track,
    abortSignal: AbortSignal
): Promise<Result<Promise<Result<AudioFrame, Status>>[], Status>> {
    return new Promise(async (resolve) => {
        abortSignal.addEventListener("abort", () => {
            return resolve(Result.error({
                code: StatusCode.CANCELLED,
                details: "Audio loading canceled"
            }));
        });
        const request = StreamAudioRequest.create({
            track_id: track.track_id
        });
        const hubClient = new HubClient(new GrpcWebFetchTransport({
            baseUrl: `http://${track.hub_id}`,
            abort: abortSignal
        }));
        const stream = hubClient.streamAudio(request, {});
        let decodingTasks: Promise<Result<AudioFrame, Status>>[] = [];
        const { MPEGDecoderWebWorker } = await import("mpg123-decoder");
        const worker = new MPEGDecoderWebWorker();

        for await (const response of stream.responses) {
            decodingTasks.push(createDecodingTask(
                audioLoader,
                worker,
                abortSignal,
                track,
                response
            ));
        };

        return resolve(Result.ok(decodingTasks));
    });
}

function createDecodingTask(
    audioLoader: AudioLoader,
    worker: MPEGDecoderWebWorker,
    abortSignal: AbortSignal,
    track: Track,
    response: StreamAudioResponse
): Promise<Result<AudioFrame, Status>> {
    return new Promise(async (resolve) => {
        abortSignal.addEventListener("abort", () => {
            return resolve(Result.error({
                code: StatusCode.CANCELLED,
                details: "Audio loading canceled"
            }));
        });

        const frame = await decodeFrame(worker, response);

        if (frame.isError()) {
            return resolve(Result.error(frame.error()));
        }

        audioLoader.emitter.emitFrame(track, frame.value())

        return resolve(Result.ok(frame.value()));
    })
}

async function decodeFrame(
    worker: MPEGDecoderWebWorker,
    response: StreamAudioResponse
): Promise<Result<AudioFrame, Status>> {
    try {
        return Result.ok(createMpegAudioFrame(
            response.chunk_id,
            await worker.decodeFrame(response.chunk)
        ));
    } catch (error) {
        return Result.error({
            code: StatusCode.INVALID_ARGUMENT,
            details: "Failed to decode frame"
        });
    }
}


function createMpegAudioFrame(chunkId: number, decodedAudio: MPEGDecodedAudio): AudioFrame {
    return {
        frameId: chunkId,
        buffer: createAudioBufferFromDecodedMpegFrame(decodedAudio)
    };
}

function createAudioBufferFromDecodedMpegFrame(decodedAudio: MPEGDecodedAudio) {
    const audioBuffer = new AudioBuffer({
        sampleRate: decodedAudio.sampleRate,
        length: decodedAudio.channelData[0].length,
        numberOfChannels: decodedAudio.channelData.length
    });

    for (let channel = 0; channel < decodedAudio.channelData.length; channel++) {
        audioBuffer.getChannelData(channel).set(decodedAudio.channelData[channel]);
    }

    return audioBuffer;
}

function insertIdleFrame(audioFrame: AudioFrame, idleFrames: AudioFrame[]): AudioFrame[] {
    let inserted = false;
    const newIdleFrames = [...idleFrames];

    for (let i = 0; i < newIdleFrames.length; i++) {
        if (audioFrame.frameId < newIdleFrames[i].frameId) {
            newIdleFrames.splice(i, 0, audioFrame);
            inserted = true;
            break;
        }
    }

    if (!inserted) {
        newIdleFrames.push(audioFrame);
    }

    return newIdleFrames;
}

function createAudioSegment(
    audioOutput: AudioOutput,
    audioFrame: AudioFrame,
    trackNodes: AudioSegment[]
): AudioSegment {
    let scheduledTimeSeconds = 0;

    if (trackNodes.length > 0) {
        let previousTrackNode = trackNodes[trackNodes.length - 1];
        scheduledTimeSeconds = previousTrackNode.duration.seconds()
            + previousTrackNode.scheduledTime.seconds();
    }

    const audioBufferSource = audioOutput.context.createBufferSource();
    audioBufferSource.connect(audioOutput.gainNode);
    audioBufferSource.buffer = audioFrame.buffer;
    let now = new Date();
    audioBufferSource.addEventListener("ended", () => console.log(audioFrame.frameId, now.getTime()))

    return {
        frameId: audioFrame.frameId,
        audioBufferSource,
        duration: Duration.fromSeconds(audioFrame.buffer.duration),
        scheduledTime: Time.fromUnixSeconds(scheduledTimeSeconds),
    }
}


