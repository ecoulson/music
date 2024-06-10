import { HubClient } from "../generated/hub.client";
import { Track } from "../generated/hub";
import { Audio, createAudioLoader, loadAudioForTrack, playAudioSegment } from "./audio";
import { Optional } from "./optional";
import { AudioOutput } from "./player";
import { Result } from "./result";
import { Duration, Time } from "./time";
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";

export interface Scheduler {
    events: PlaybackEvent[];
    bufferSize: number;
    bufferedTracks: Audio[];
}

interface PlaybackEvent {
    track: Track,
    offset: Duration
}

export function createScheduler(bufferTrackSize: number): Scheduler {
    return {
        bufferSize: bufferTrackSize,
        events: [],
        bufferedTracks: []
    }
}

function createPlaybackEvent(track: Track, offset: Duration): PlaybackEvent {
    return {
        track,
        offset
    };
}

export async function queueTrack(
    scheduler: Scheduler,
    audioOutput: AudioOutput,
    track: Track,
    onSegment: Optional<() => void> // TODO: consider using an event emitter
): Promise<Result<Optional<PlaybackEvent>, DOMException>> {
    const trackOffset = Duration.fromMilliseconds(scheduler.events.reduce<number>(
        (offset, event) => offset + event.track.duration_milliseconds, 0));
    const playbackEvent = createPlaybackEvent(track, trackOffset);
    scheduler.events.push(playbackEvent);

    if (scheduler.bufferedTracks.length == scheduler.bufferSize) {
        console.log("lazy load this track");
        return Result.ok(Optional.empty());
    }

    const trackLoader = createAudioLoader(audioOutput, new HubClient(new GrpcWebFetchTransport({
        baseUrl: `http://${track.hub_id}`,
    })));
    const audio = await loadAudioForTrack(trackLoader, track, (segment) => {
        playAudioSegment(segment, trackOffset);

        if (onSegment.some()) {
            onSegment.unwrap()();
        }
    });

    if (!audio.ok()) {
        return Result.error(audio.error())
    }

    return Result.ok(Optional.of(playbackEvent));
}


export function clearScheduledAudio(scheduler: Scheduler, audio: AudioOutput) {
}

export function adjustSchedule(scheduler: Scheduler, audio: AudioOutput, offset: Time) {
}
