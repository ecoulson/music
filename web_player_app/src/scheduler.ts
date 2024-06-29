import { Track } from "../generated/hub";
import { AudioLoader, AudioSegment, cancelAudioLoad, cancelAudioSegment, loadAudioForTrack, playAudioSegment } from "./audio";
import { Optional } from "./optional";
import { AudioOutput } from "./player";
import { Result } from "./result";
import { Tape, capacity, createTape, isEmpty, shiftRight, size, sliceRight, write } from "./tape";
import { Duration, Time } from "./time";
import { Status } from "grpc-web";

export interface Scheduler {
    audioLoader: AudioLoader;
    trackTape: Tape<PlaybackEvent>;
    schedule: Track[];
    currentTrackIndex: number;
}

export interface PlaybackEvent {
    sequenceId: number,
    track: Track,
    offset: Duration
    segments: AudioSegment[],
}

export function createScheduler(audioLoader: AudioLoader, trackBufferSize: number): Scheduler {
    return {
        audioLoader,
        trackTape: createTape(trackBufferSize),
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
    const trackOffset = Duration.fromMilliseconds(0);
    const playbackEvent = createPlaybackEvent(scheduler.currentTrackIndex, track, trackOffset);

    write(scheduler.trackTape, playbackEvent);

    if (scheduler.schedule.length == 0) {
        scheduler.schedule.push(track);
    } else {
        clearScheduledAudio(scheduler);
        scheduler.schedule[scheduler.currentTrackIndex] = track;
    }

    const audio = await loadAudioForTrack(scheduler.audioLoader, track, (segment) => {
        playbackEvent.segments.push(segment);
        playAudioSegment(segment, Duration.fromSeconds(0));

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
    const trackOffset = Duration.fromMilliseconds(scheduler.schedule.reduce<number>(
        (offset, track) => offset + track.duration_milliseconds, 0));
    const playbackEvent = createPlaybackEvent(scheduler.currentTrackIndex, track, trackOffset);
    scheduler.schedule.push(track);

    if (size(scheduler.trackTape) == capacity(scheduler.trackTape)) {
        console.log("lazy load this track");
        return Result.ok(Optional.empty());
    }

    if (isEmpty(scheduler.trackTape)) {
        write(scheduler.trackTape, playbackEvent);
    } else {
        shiftRight(scheduler.trackTape, playbackEvent);
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
    for (const event of sliceRight(scheduler.trackTape)) {
        for (const segment of event.segments) {
            cancelAudioSegment(segment);
        }
    }
}

export function skipTrack(scheduler: Scheduler, audio: AudioOutput) {
}

export function adjustSchedule(
    scheduler: Scheduler,
    trackOffset: Duration,
    audioOutput: AudioOutput
) {
    if (isEmpty(scheduler.trackTape)) {
        return;
    }

    let offset = Duration.fromSeconds(audioOutput.context.currentTime);
    const activeTrackPlaybacks = sliceRight(scheduler.trackTape);
    const currentTrackPlayback = activeTrackPlaybacks[0];
    const startTime = currentTrackPlayback.segments[0].scheduledTimeRange.start;
    const trackContextOffset = startTime.add(Time.fromUnixSeconds(trackOffset.seconds()));
    let segmentIndex = 0;
    let skippedDuration = Duration.fromSeconds(0);

    while (currentTrackPlayback.segments[segmentIndex].scheduledTimeRange.start.seconds() <= trackContextOffset.seconds() && trackContextOffset.seconds() < currentTrackPlayback.segments[segmentIndex].scheduledTimeRange.end.seconds()) {
        segmentIndex++;
        skippedDuration.add(currentTrackPlayback.segments[segmentIndex].duration);
    }

    if (currentTrackPlayback.segments.length <= segmentIndex) {
        console.log("Should pause playback in unloaded frame");
        return;
    }

    let end = offset.add(trackOffset.subtract(skippedDuration));
    currentTrackPlayback.segments[segmentIndex].scheduledTimeRange = {
        start: Time.fromUnixSeconds(offset.seconds()),
        end: Time.fromUnixSeconds(end.seconds())
    }
    cancelAudioSegment(currentTrackPlayback.segments[segmentIndex]);
    playAudioSegment(currentTrackPlayback.segments[segmentIndex], trackOffset);
    offset = end;

    for (let i = segmentIndex + 1; i < currentTrackPlayback.segments.length; i++) {
        let end = offset.add(currentTrackPlayback.segments[i].duration);
        currentTrackPlayback.segments[i].scheduledTimeRange = {
            start: Time.fromUnixSeconds(offset.seconds()),
            end: Time.fromUnixSeconds(end.seconds())
        }
        cancelAudioSegment(currentTrackPlayback.segments[i]);
        playAudioSegment(currentTrackPlayback.segments[i], Duration.fromSeconds(0));
        offset = end;
    }

    if (activeTrackPlaybacks.length == 1) {
        return;
    }


    for (const event of activeTrackPlaybacks.slice(1)) {

        for (const segment of event.segments) {
            segment.scheduledTimeRange = {
                start: Time.fromUnixSeconds(offset.seconds()),
                end: Time.fromUnixSeconds(end.seconds())
            }
            offset = end;
            cancelAudioSegment(segment);
            playAudioSegment(segment, offset);
        }

        offset = offset.add(
            Duration.fromMilliseconds(event.track.duration_milliseconds));
    }
}
