import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { Track } from "../generated/hub";
import { HubClient } from "../generated/hub.client";
import { addHtmxListener, mount, querySelector } from "./dom";
import { Optional } from "./optional";
import { Result } from "./result";
import { Scheduler, createScheduler, queueTrack } from "./scheduler";
import { Slider, addSliderHandlers, createSlider, mountSlider, repositionSlider } from "./slider";
import { Duration, Time } from "./time";
import { PlayerState } from "../generated/player";

type AudioStateChangeHandler = (state: PlaybackState) => void;

enum PlaybackState {
    Initialized,
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
    playButton: HTMLButtonElement;
    scheduler: Scheduler;
    currentTrackPlayback: Optional<TrackPlayback>
}

interface TrackKey {
    trackId: string,
    hubId: string
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
    const root = querySelector(document, rootSelector);

    if (root.none()) {
        return Result.error("Root not found");
    }

    const playButton = querySelector<HTMLButtonElement>(root.unwrap(), "#play-button");

    if (playButton.none()) {
        return Result.error("Failed to find playback controller input");
    }

    const currentTrackKeyResult = createTrackKey();

    if (currentTrackKeyResult.isError()) {
        return Result.error(currentTrackKeyResult.error());
    }

    const currentTrackKey = currentTrackKeyResult.unwrap();
    const audioOutput = createAudioOutput();
    const playbackSlider = createSlider("#playback-scrubber");
    const volumeSlider = mountSlider("#volume-control", {
        onSlideEnd: Optional.empty(),
        onSlideStart: Optional.empty(),
        onSlide: Optional.of((volume) => setVolume(audioOutput, volume)),
    }).unwrap();

    // load current track playback
    const currentTrackPlayback = Optional.empty();

    if (currentTrackKey.some()) {
        console.log(currentTrackKey);
    }

    if (!playbackSlider.ok()) {
        return Result.error(playbackSlider.error());
    }

    return Result.ok({
        playbackState: PlaybackState.Initialized,
        audioOutput,
        playButton: playButton.unwrap(),
        playbackSlider: playbackSlider.unwrap(),
        volumeSlider,
        scheduler: createScheduler(/*buffer_size=*/5),
        currentTrackPlayback,
    });
}

function createTrackKey(): Result<Optional<TrackKey>, string> {
    let initialTrackIdResult = querySelector<HTMLMetaElement>(document.head, "meta[name='initial_track_id']");
    let initialHubIdResult = querySelector<HTMLMetaElement>(document.head, "meta[name='initial_hub_id']");

    if (initialTrackIdResult.none()) {
        return Result.error("Failed to get track id");
    }

    if (initialHubIdResult.none()) {
        return Result.error("Failed to get track hub id");
    }

    let initialTrackId = initialTrackIdResult.unwrap();
    let initialHubId = initialHubIdResult.unwrap();

    if (initialTrackId.content.length === 0 && initialHubId.content.length === 0) {
        return Result.ok(Optional.empty());
    }

    return Result.ok(Optional.of({
        trackId: initialTrackId.content,
        hubId: initialHubId.content
    }));
}

function addPlayerHandlers(player: Player, handlers: PlayerHandlers): Result<boolean, string> {
    addSliderHandlers(player.playbackSlider, {
        onSlide: Optional.of((value) => handlePlaybackSlide(player, value)),
        onSlideStart: Optional.empty(),
        onSlideEnd: Optional.empty()
    }).unwrap();

    player.playButton.addEventListener("click", () => handlePlaybackState(player));
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

    addHtmxListener<PlayerState>("player_state_change", (event) => {
        if (event.detail.hub_id.length == 0 && event.detail.track_id.length == 0) {
            return;
        }

        player.playButton.disabled = false;
        // queue here?
    });

    return Result.ok(true);
}

async function playTrack(player: Player) {
    player.playButton.textContent = "Pause";
    player.playbackState = PlaybackState.Loading;
    const trackPlayback = player.currentTrackPlayback.unwrap();
    const hubClient = new HubClient(new GrpcWebFetchTransport({
        baseUrl: `http://${trackPlayback.track.hub_id}`
    }));
    const trackResponse = await hubClient.getTrack({
        track_id: trackPlayback.track.track_id
    });

    if (!trackResponse.response.track) {
        console.error("No track loaded");
        player.playbackState = PlaybackState.Error;
        return;
    }

    const track = trackResponse.response.track;
    const event = await queueTrack(player.scheduler, player.audioOutput, track, Optional.of(() => {
        if (player.currentTrackPlayback.some()) {
            return;
        }

        player.currentTrackPlayback = Optional.of(
            createTrackPlayback(track, startAudioPlaybackMonitoring(player)));
    }));

    if (event.isError()) {
        console.error("Failed to queue track", event.error());
        player.playbackState = PlaybackState.Error;
        return;
    }
}

function tooglePlaybackController(player: Player, state: PlaybackState) {
    switch (state) {
        case PlaybackState.Playing:
        case PlaybackState.Loading:
            player.playButton.innerText = "Pause";
            break;
        case PlaybackState.Complete:
        case PlaybackState.Paused:
            player.playButton.innerText = "Play";
            break;
        case PlaybackState.Error:
            player.playButton.innerText = "Error";
            break;
        default:
            break;
    }
}

async function handlePlaybackState(player: Player) {
    if (player.currentTrackPlayback.none()) {
        console.error("Song not selected");
        player.playbackState = PlaybackState.Error;
        return;
    }

    switch (player.playbackState) {
        case PlaybackState.Paused:
            player.playButton.textContent = "Play";
            play(player.audioOutput);
            break;
        case PlaybackState.Playing:
            player.playButton.textContent = "Pause";
            pause(player.audioOutput);
            break;
        case PlaybackState.Initialized:
            player.playButton.textContent = "Pause";
            player.playbackState = PlaybackState.Loading;
            const trackPlayback = player.currentTrackPlayback.unwrap();
            const hubClient = new HubClient(new GrpcWebFetchTransport({
                baseUrl: `http://${trackPlayback.track.hub_id}`
            }));
            const trackResponse = await hubClient.getTrack({
                track_id: trackPlayback.track.track_id
            });

            if (!trackResponse.response.track) {
                console.error("No track loaded");
                player.playbackState = PlaybackState.Error;
                return;
            }

            const track = trackResponse.response.track;
            const event = await queueTrack(player.scheduler, player.audioOutput, track, Optional.of(() => {
                if (player.currentTrackPlayback.some()) {
                    return;
                }

                player.currentTrackPlayback = Optional.of(
                    createTrackPlayback(track, startAudioPlaybackMonitoring(player)));
            }));

            if (event.isError()) {
                console.error("Failed to queue track", event.error());
                player.playbackState = PlaybackState.Error;
                return;
            }

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
        duration: Duration.fromMilliseconds(track.duration_milliseconds)
    }
}

function handlePlaybackSlide(player: Player, value: number) {
    const offset = Time.fromUnixMilliseconds(
        player.scheduler.bufferedTracks[0].duration.milliseconds() * value);
    console.log(offset);
}
