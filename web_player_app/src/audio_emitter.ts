import { Status } from "grpc-web";
import { Emitter, EventKey, EventListener } from "./events";
import { Track } from "../generated/hub";
import { AudioFrame } from "./audio";

export interface CancelEvent {
    canceledTrack: Track
}

export interface FrameEvent {
    frame: AudioFrame,
    track: Track
}

export interface ErrorEvent {
    trackId: string,
    error: Status
}


export type AudioLoaderEmitterEventMap = {
    cancel: CancelEvent,
    frame: FrameEvent,
    error: ErrorEvent,
}

export class AudioLoaderEmitter {
    emitter: Emitter<AudioLoaderEmitterEventMap>;

    constructor() {
        this.emitter = new Emitter();
    }

    onCancel(
        trackId: string,
        abortController: AbortController,
        handler: (event: CancelEvent) => void
    ): EventListener<CancelEvent> {
        return this.emitter.on("cancel", (event) => {
            if (trackId !== event.canceledTrack.track_id) {
                return;
            }

            abortController.abort();
            handler(event);
        });
    }

    onFrame(
        trackId: string,
        handler: (event: FrameEvent) => void
    ): EventListener<FrameEvent> {
        return this.emitter.on("frame", (event) => {
            if (trackId !== event.track.track_id) {
                return;
            }

            handler(event);
        });
    }

    onError(
        trackId: string,
        abortController: AbortController,
        handler: (event: ErrorEvent) => void
    ): EventListener<ErrorEvent> {
        return this.emitter.on("error", (event) => {
            if (event.trackId !== trackId) {
                return;
            }

            abortController.abort();
            handler(event);
        });
    }

    off<K extends EventKey<AudioLoaderEmitterEventMap>>(
        key: K,
        listener: EventListener<AudioLoaderEmitterEventMap[K]>
    ): number {
        return this.emitter.off(key, listener);
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

