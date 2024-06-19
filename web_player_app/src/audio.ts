import { MPEGDecodedAudio, MPEGDecoderWebWorker } from "mpg123-decoder";
import { HubClient } from "../generated/hub.client";
import { StreamAudioRequest, StreamAudioResponse, Track } from "../generated/hub";
import { Result } from "./result";
import { Duration, Time, Timerange } from "./time";
import { Status, StatusCode } from "grpc-web";
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { AudioOutput } from "./player";
import { AudioLoaderEmitter } from "./audio_emitter";

export interface Audio {
    trackId: string;
    duration: Duration;
    segments: AudioSegment[];
    scheduledTimeRange: Timerange;
}

export interface AudioSegment {
    frameId: number;
    contextTime: Time,
    audioBufferSource: AudioBufferSourceNode;
    scheduledTime: Time;
    duration: Duration;
}

export interface AudioLoader {
    audio: PlayerAudio;
    emitter: AudioLoaderEmitter;
}

interface PlayerAudio {
    context: AudioContext;
    gainNode: GainNode;
}

export interface AudioFrame {
    buffer: AudioBuffer;
    frameId: number;
}

interface LoadContext {
    idleFrames: AudioFrame[],
    audioSegments: AudioSegment[],
    onSegment: (segment: AudioSegment) => void,
    abortSignal: AbortSignal
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
        const loadContext = createLoadContext(onSegment, abortController);
        const errorListener = audioLoader.emitter.onError(track.track_id, abortController, (event) => {
            audioLoader.emitter.off("error", errorListener);
            audioLoader.emitter.off("cancel", cancelListener);
            audioLoader.emitter.off("frame", frameListener);
            return resolve(Result.error(event.error));
        });
        const cancelListener = audioLoader.emitter.onCancel(track.track_id, abortController, () => {
            audioLoader.emitter.off("error", errorListener);
            audioLoader.emitter.off("cancel", cancelListener);
            audioLoader.emitter.off("frame", frameListener);
            return resolve(Result.error({
                code: StatusCode.CANCELLED,
                details: "Audio load canceled"
            }))
        });
        const frameListener = audioLoader.emitter.onFrame(track.track_id, (event) =>
            handleFrameInContext(audioLoader, event.frame, loadContext));
        const audioSegments = await loadAudioSegments(audioLoader, track, loadContext);
        const trackDuration = Duration.fromMilliseconds(track.duration_milliseconds);
        audioLoader.emitter.off("error", errorListener);
        audioLoader.emitter.off("cancel", cancelListener);
        audioLoader.emitter.off("frame", frameListener);

        if (audioSegments.isError()) {
            return resolve(Result.error(audioSegments.error()));
        }

        return resolve(Result.ok({
            trackId: track.track_id,
            segments: audioSegments.value(),
            duration: trackDuration,
            scheduledTimeRange: {
                start: Time.fromUnixSeconds(0),
                end: Time.fromUnixSeconds(trackDuration.seconds()),
            }
        }));
    });
}

function createLoadContext(
    onSegment: (segment: AudioSegment) => void,
    abortController: AbortController
): LoadContext {
    return {
        onSegment,
        abortSignal: abortController.signal,
        idleFrames: [],
        audioSegments: [],
    }
}

function handleFrameInContext(
    audioLoader: AudioLoader,
    frame: AudioFrame,
    loadContext: LoadContext
) {
    if (loadContext.abortSignal.aborted) {
        return;
    }

    if (frame.frameId == loadContext.audioSegments.length) {
        const segment = createAudioSegment(audioLoader.audio, frame, loadContext);
        loadContext.onSegment(segment);
        loadContext.audioSegments.push(segment);
        return;
    }

    loadContext.idleFrames = insertIdleFrame(frame, loadContext.idleFrames);

    while (loadContext.idleFrames.length > 0 && loadContext.idleFrames[0].frameId == loadContext.audioSegments.length) {
        const segment = createAudioSegment(
            audioLoader.audio,
            loadContext.idleFrames.shift()!,
            loadContext
        );
        loadContext.onSegment(segment);
        loadContext.audioSegments.push(segment);
    }
}

function loadAudioSegments(
    audioLoader: AudioLoader,
    track: Track,
    loadContext: LoadContext
): Promise<Result<AudioSegment[], Status>> {
    return new Promise(async (resolve) => {
        loadContext.abortSignal.addEventListener("abort", () => {
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
            abort: loadContext.abortSignal
        }));
        const stream = hubClient.streamAudio(request, {});
        let decodingTasks: Promise<Result<AudioFrame, Status>>[] = [];
        const { MPEGDecoderWebWorker } = await import("mpg123-decoder");
        const worker = new MPEGDecoderWebWorker();

        for await (const response of stream.responses) {
            decodingTasks.push(createDecodingTask(
                audioLoader,
                worker,
                loadContext.abortSignal,
                track,
                response
            ));
        };

        await Promise.all(decodingTasks);

        return resolve(Result.ok(loadContext.audioSegments));
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
    loadContext: LoadContext
): AudioSegment {
    let scheduledTimeSeconds = 0;

    if (loadContext.audioSegments.length > 0) {
        let previousTrackNode = loadContext.audioSegments[loadContext.audioSegments.length - 1];
        scheduledTimeSeconds = previousTrackNode.duration.seconds()
            + previousTrackNode.scheduledTime.seconds();
    }

    const audioBufferSource = audioOutput.context.createBufferSource();
    audioBufferSource.connect(audioOutput.gainNode);
    audioBufferSource.buffer = audioFrame.buffer;

    return {
        contextTime: Time.fromUnixSeconds(audioOutput.context.currentTime),
        frameId: audioFrame.frameId,
        audioBufferSource,
        duration: Duration.fromSeconds(audioFrame.buffer.duration),
        scheduledTime: Time.fromUnixSeconds(scheduledTimeSeconds),
    }
}


