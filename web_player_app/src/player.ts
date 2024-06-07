import { Track } from "../generated/hub";
import { mount } from "./dom";
import { Optional } from "./optional";
import { Result } from "./result";
import { Scheduler, createScheduler, queueTrack } from "./scheduler";
import { Slider, addSliderHandlers, createSlider, mountSlider, repositionSlider } from "./slider";
import { Duration, Time } from "./time";

type AudioStateChangeHandler = (state: PlaybackState) => void;

enum PlaybackState {
    Unknown,
    Paused,
    Playing,
    Loading,
    Error,
    Complete,
}

export interface AudioOutput {
    context: AudioContext;
    gainNode: GainNode;
}

export interface Player {
    playbackState: PlaybackState;
    audioOutput: AudioOutput;
    volumeSlider: Slider;
    playbackSlider: Slider;
    playbackController: HTMLButtonElement;
    scheduler: Scheduler;
    currentTrackPlayback: Optional<TrackPlayback>
}

interface TrackPlayback {
    position: Time;
    duration: Duration;
    track: Track;
    intervalId: number;
}

interface PlayerHandlers {
    onPlaybackStateChange: Optional<AudioStateChangeHandler>;
}

function createAudioOutput(): AudioOutput {
    const context = new AudioContext();
    const gainNode = context.createGain();
    gainNode.connect(context.destination);

    return {
        context,
        gainNode
    };
}

function setVolume(output: AudioOutput, volumeLevel: number): void {
    output.gainNode.gain.setValueAtTime(volumeLevel, output.context.currentTime);
}

export function mountPlayer(selector: string, handlers: PlayerHandlers): Result<Player, string> {
    return mount(createPlayer, addPlayerHandlers)(selector, handlers);
}

function createPlayer(rootSelector: string): Result<Player, string> {
    const root = document.querySelector(rootSelector);

    if (!root) {
        return Result.error("Root not found");
    }

    const playbackController = root.querySelector<HTMLButtonElement>("#playback-state");

    if (!playbackController) {
        return Result.error("Failed to find playback controller input");
    }

    const audioOutput = createAudioOutput();
    const playbackSlider = createSlider("#playback-scrubber");
    const volumeSlider = mountSlider("#volume-control", {
        onSlideEnd: Optional.empty(),
        onSlideStart: Optional.empty(),
        onSlide: Optional.of((volume) => setVolume(audioOutput, volume)),
    }).unwrap();

    if (!playbackSlider.ok()) {
        return Result.error(playbackSlider.error());
    }

    return Result.ok({
        playbackState: PlaybackState.Unknown,
        audioOutput,
        playbackController,
        playbackSlider: playbackSlider.unwrap(),
        volumeSlider,
        scheduler: createScheduler(/*buffer_size=*/5),
        currentTrackPlayback: Optional.empty()
    });
}

function addPlayerHandlers(player: Player, handlers: PlayerHandlers): Result<boolean, string> {
    addSliderHandlers(player.playbackSlider, {
        onSlide: Optional.of((value) => handlePlaybackSlide(player, value)),
        onSlideStart: Optional.empty(),
        onSlideEnd: Optional.empty()
    }).unwrap();

    player.playbackController.addEventListener("click", () => handlePlaybackState(player));
    player.audioOutput.context.addEventListener("statechange", () => {
        switch (player.audioOutput.context.state) {
            case "running":
                player.playbackState = PlaybackState.Playing;
                tooglePlaybackController(player, PlaybackState.Playing);
                break;
            case "suspended":
                player.playbackState = PlaybackState.Paused;
                tooglePlaybackController(player, PlaybackState.Paused);
                break;
            case "closed":
                player.playbackState = PlaybackState.Complete;
                tooglePlaybackController(player, PlaybackState.Complete);
                break;
        }

        if (handlers.onPlaybackStateChange.some()) {
            handlers.onPlaybackStateChange.unwrap()(player.playbackState);
        }
    });

    return Result.ok(true);
}

function tooglePlaybackController(player: Player, state: PlaybackState) {
    switch (state) {
        case PlaybackState.Playing:
        case PlaybackState.Loading:
            player.playbackController.innerText = "Pause";
            break;
        case PlaybackState.Complete:
        case PlaybackState.Paused:
            player.playbackController.innerText = "Play";
            break;
        case PlaybackState.Error:
            player.playbackController.innerText = "Error";
            break;
        default:
            break;
    }
}

function handlePlaybackState(player: Player) {
    const stateElement = document.getElementById("playback-state");
    const trackIdInput: HTMLInputElement = document.getElementById("playback-track-id") as HTMLInputElement;
    const trackHubIdInput: HTMLInputElement = document.getElementById("playback-hub-id") as HTMLInputElement;

    if (!stateElement) {
        console.error("Failed to get playback state component");
        return;
    }

    if (!trackIdInput) {
        console.error("Failed to get track id");
        return;
    }

    if (!trackHubIdInput) {
        console.error("Failed to get track hub id");
        return;
    }

    switch (player.playbackState) {
        case PlaybackState.Paused:
            play(player.audioOutput);
            break;
        case PlaybackState.Playing:
            pause(player.audioOutput);
            break;
        case PlaybackState.Unknown:
            stateElement.textContent = "Pause";
            player.playbackState = PlaybackState.Loading;
            // Fetch track instead
            const track = Track.create({
                trackId: trackIdInput.value,
                hubId: trackHubIdInput.value,
                durationMilliseconds: 472436.9841269841
            });
            queueTrack(player.scheduler, player.audioOutput, track).then((event) => {
                if (!event.ok()) {
                    console.error("Failed to queue track", event.error());
                    player.playbackState = PlaybackState.Error;
                    return;
                }

                if (event.unwrap().none()) {
                    console.error("Lazy loading track");
                    player.playbackState = PlaybackState.Error;
                    return;
                }

                console.log(player);
                if (player.currentTrackPlayback.none()) {
                    console.error("No playback set");
                    player.playbackState = PlaybackState.Error;
                    return;
                }

                const currentTrackPlayback = player.currentTrackPlayback.unwrap();
                const queuedTrack = event.unwrap().unwrap().track;

                if (currentTrackPlayback.track.trackId === queuedTrack.trackId) {
                    player.currentTrackPlayback = Optional.of(
                        createTrackPlayback(track, startAudioPlaybackMonitoring(player)));
                }
            });
            break;
        case PlaybackState.Loading:
            break;
        default:
            console.error("Unhandled playback state");
            break;
    }
}

function pause(audioOutput: AudioOutput): void {
    audioOutput.context.suspend();
}

function play(audioOutput: AudioOutput): void {
    audioOutput.context.resume();
}

function getOutputCurrentTimeMs(output: AudioOutput): Result<Time, string> {
    let currentTimeSeconds = output.context.getOutputTimestamp().contextTime;

    if (typeof currentTimeSeconds === "undefined") {
        return Result.error("Couldn't get current time");
    }

    return Result.ok(Time.fromUnixSeconds(currentTimeSeconds));
}

function handlePlaybackTick(player: Player, trackPlayback: TrackPlayback): PlaybackState {
    let currentTime = getOutputCurrentTimeMs(player.audioOutput);

    if (!currentTime.ok()) {
        console.error("Couldn't retreive context time");
        return PlaybackState.Loading;
    }

    if (player.playbackState != PlaybackState.Playing) {
        return player.playbackState;
    }

    let progress = currentTime.unwrap().milliseconds() /
        trackPlayback.duration.milliseconds()

    if (isNaN(progress) || !isFinite(progress)) {
        console.error("Playback being handled before audio loaded");
        return PlaybackState.Error;
    }

    if (progress >= 1) {
        return PlaybackState.Complete;
    }

    if (!player.playbackSlider.isSliding) {
        repositionSlider(player.playbackSlider, progress);
    }

    return PlaybackState.Playing;
}

function startAudioPlaybackMonitoring(player: Player): number {
    const intervalId = setInterval(() => {
        if (player.currentTrackPlayback.none()) {
            console.error("No current track playing");
            clearInterval(intervalId);
            return;
        }

        const currentTrackPlayback = player.currentTrackPlayback.unwrap();
        currentTrackPlayback.position.add(Time.fromUnixMilliseconds(100));

        switch (handlePlaybackTick(player, currentTrackPlayback)) {
            case PlaybackState.Error:
            case PlaybackState.Complete:
                clearInterval(intervalId);
                break;
            default:
                break;
        }
    }, 100);

    return intervalId;
}

function createTrackPlayback(track: Track, intervalId: number): TrackPlayback {
    return {
        track,
        intervalId,
        position: Time.fromUnixSeconds(0),
        duration: Duration.fromMilliseconds(track.durationMilliseconds)
    }
}

function handlePlaybackSlide(player: Player, value: number) {
    const offset = Time.fromUnixMilliseconds(
        player.scheduler.bufferedTracks[0].duration.milliseconds() * value);
    console.log(offset);
}
