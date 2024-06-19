import { Track } from "../generated/hub";
import { AudioLoader, AudioSegment, cancelAudioLoad, loadAudioForTrack, playAudioSegment } from "./audio";
import { Optional } from "./optional";
import { AudioOutput } from "./player";
import { Result } from "./result";
import { Duration } from "./time";
import { Status } from "grpc-web";

export interface Scheduler {
    audioLoader: AudioLoader;
    bufferedTracks: PlaybackEvent[];
    schedule: Track[];
    currentTrackIndex: number;
    bufferTrackSize: number;
}

export interface PlaybackEvent {
    sequenceId: number,
    track: Track,
    offset: Duration
    segments: AudioSegment[],
}

export function createScheduler(audioLoader: AudioLoader, bufferTrackSize: number): Scheduler {
    return {
        audioLoader,
        bufferTrackSize,
        // treat as ring buffer
        bufferedTracks: [],
        schedule: [],
        currentTrackIndex: 0
    }
}

function createPlaybackEvent(sequenceId: number, track: Track, offset: Duration): PlaybackEvent {
    return {
        sequenceId,
        track,
        offset,
        segments: []
    };
}

export function cancelLoad(scheduler: Scheduler, track: Track) {
    cancelAudioLoad(scheduler.audioLoader, track);
}

export async function swapTrack(
    scheduler: Scheduler,
    track: Track,
    onSegment: Optional<() => void>
): Promise<Result<Optional<PlaybackEvent>, Status>> {
    const trackOffset = Duration.fromMilliseconds(
        scheduler.bufferedTracks.slice(0, scheduler.currentTrackIndex).reduce<number>(
            (offset, event) => offset + event.track.duration_milliseconds, 0));
    const playbackEvent = createPlaybackEvent(scheduler.currentTrackIndex, track, trackOffset);

    if (scheduler.schedule.length == 0) {
        scheduler.schedule.push(track);
        scheduler.bufferedTracks.push(playbackEvent);
    } else {
        clearScheduledAudio(scheduler);
        scheduler.schedule[scheduler.currentTrackIndex] = track;
        scheduler.bufferedTracks[scheduler.currentTrackIndex] = playbackEvent;
    }

    const audio = await loadAudioForTrack(scheduler.audioLoader, track, (segment) => {
        playbackEvent.segments.push(segment);
        const contextOffset = Duration.fromSeconds(playbackEvent.segments[0].contextTime.seconds());
        playAudioSegment(segment, trackOffset.add(contextOffset));

        if (onSegment.some()) {
            onSegment.unwrap()();
        }
    });

    if (!audio.ok()) {
        for (const segment of playbackEvent.segments) {
            segment.audioBufferSource.disconnect();
        }

        return Result.error(audio.error())
    }

    return Result.ok(Optional.of(playbackEvent));
}

export async function queueTrack(
    scheduler: Scheduler,
    track: Track,
    onSegment: Optional<() => void>
): Promise<Result<Optional<PlaybackEvent>, Status>> {
    const trackOffset = Duration.fromMilliseconds(scheduler.bufferedTracks.reduce<number>(
        (offset, event) => offset + event.track.duration_milliseconds, 0));
    const playbackEvent = createPlaybackEvent(scheduler.currentTrackIndex, track, trackOffset);
    scheduler.schedule.push(track);

    if (scheduler.bufferedTracks.length == scheduler.bufferTrackSize) {
        console.log("lazy load this track");
        return Result.ok(Optional.empty());
    }

    const audio = await loadAudioForTrack(scheduler.audioLoader, track, (segment) => {
        playbackEvent.segments.push(segment);
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


export function clearScheduledAudio(scheduler: Scheduler) {
    for (const event of scheduler.bufferedTracks) {
        for (const segment of event.segments) {
            segment.audioBufferSource.disconnect();
        }
    }
}

export function skipTrack(scheduler: Scheduler, audio: AudioOutput) {
}

export function adjustSchedule(scheduler: Scheduler, offset: Duration) {
    if (scheduler.bufferedTracks.length == 0) {
        return;
    }

    clearScheduledAudio(scheduler);
}
