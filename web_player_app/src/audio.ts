import { MPEGDecodedAudio } from "mpg123-decoder";
import { HubClient } from "../generated/hub.client";
import { StreamAudioRequest, Track } from "../generated/hub";
import { Result } from "./result";
import { Duration, Time, Timerange } from "./time";

export interface Audio {
    trackId: string;
    duration: Duration;
    segments: AudioSegment[];
    scheduledTimeRange: Timerange;
}

interface AudioSegment {
    audioBufferSource: AudioBufferSourceNode;
    scheduledTime: Time;
    duration: Duration;
}

interface AudioChunk {
    buffer: AudioBuffer;
    chunkId: number;
}

interface AudioLoader {
    audio: PlayerAudio;
    hubClient: HubClient;
}

interface PlayerAudio {
    context: AudioContext;
    gainNode: GainNode;
}

export function playAudioSegment(audio: AudioSegment, offset: Duration) {
    audio.audioBufferSource.start(offset.seconds() + audio.scheduledTime.seconds());
}

export function createAudioLoader(audio: PlayerAudio, hubClient: HubClient): AudioLoader {
    return {
        audio,
        hubClient,
    };
}

export function loadAudioForTrack(
    loader: AudioLoader,
    track: Track,
    onSegmentLoaded: (segment: AudioSegment) => void
): Promise<Result<Audio, DOMException>> {
    const request = StreamAudioRequest.create({
        track_id: track.track_id
    });
    const stream = loader.hubClient.streamAudio(request, {});

    return new Promise(async (resolve) => {
        const audioSegments: AudioSegment[] = [];
        let idleChunks: AudioChunk[] = [];
        let decodingTasks: Promise<any>[] = [];
        const { MPEGDecoderWebWorker } = await import("mpg123-decoder");
        const worker = new MPEGDecoderWebWorker();

        stream.responses.onMessage((response) => {
            decodingTasks.push(worker.decodeFrame(response.chunk).then((decodedAudio) => {
                const audioBufferSource = loader.audio.context.createBufferSource();
                const audioChunk = createMpegAudioChunk(response.chunk_id, decodedAudio);
                audioBufferSource.connect(loader.audio.gainNode);

                if (audioChunk.chunkId == audioSegments.length) {
                    const segment = createAudioSegment(audioBufferSource, audioChunk, audioSegments);
                    onSegmentLoaded(segment);
                    audioSegments.push(segment);
                    return;
                }

                idleChunks = insertChunk(audioChunk, idleChunks);

                while (idleChunks.length > 0 && idleChunks[0].chunkId == audioSegments.length) {
                    const segment = createAudioSegment(
                        audioBufferSource,
                        idleChunks.shift()!,
                        audioSegments
                    );
                    onSegmentLoaded(segment);
                    audioSegments.push(segment);
                }
            }).catch((error) => resolve(Result.error(error))));
        })
        stream.responses.onComplete(async () => {
            await Promise.all(decodingTasks);
            const trackDuration = audioSegments.reduce<Duration>((duration, trackNode) =>
                duration.add(trackNode.duration), Duration.fromSeconds(0));

            resolve(Result.ok({
                trackId: track.track_id,
                segments: audioSegments,
                duration: trackDuration,
                scheduledTimeRange: {
                    start: Time.fromUnixSeconds(0),
                    end: Time.fromUnixSeconds(trackDuration.seconds()),
                }
            }));
        });

    });
}

function createMpegAudioChunk(chunkId: number, decodedAudio: MPEGDecodedAudio): AudioChunk {
    return {
        chunkId,
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

function createAudioSegment(
    audioBufferSource: AudioBufferSourceNode,
    audioChunk: AudioChunk,
    trackNodes: AudioSegment[]
): AudioSegment {
    let scheduledTimeSeconds = 0;

    if (trackNodes.length > 0) {
        let previousTrackNode = trackNodes[trackNodes.length - 1];
        scheduledTimeSeconds = previousTrackNode.duration.seconds()
            + previousTrackNode.scheduledTime.seconds();
    }

    audioBufferSource.buffer = audioChunk.buffer;

    return {
        audioBufferSource,
        duration: Duration.fromSeconds(audioChunk.buffer.duration),
        scheduledTime: Time.fromUnixSeconds(scheduledTimeSeconds),
    }
}
