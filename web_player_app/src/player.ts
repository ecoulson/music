import { HubClient } from "../generated/HubServiceClientPb";
import { StreamAudioRequest, StreamAudioResponse } from "../generated/hub_pb";
import { createTrackLoader, loadTrack } from "./audio";
import { mount } from "./dom";
import { Optional } from "./optional";
import { Result } from "./result";
import { Slider, mountSlider, repositionSlider } from "./slider";
import { Time } from "./time";

type AudioStateChangeHandler = (state: PlaybackState) => void;

enum PlaybackState {
    Unknown,
    Paused,
    Playing,
    Loading,
    Error,
    Complete,
}

interface PlayerAudio {
    context: AudioContext;
    gainNode: GainNode;
}

export interface Player {
    playbackState: PlaybackState;
    audioOutput: PlayerAudio;
    volumeSlider: Slider;
    playbackSlider: Slider;
    playbackController: HTMLButtonElement;
}

interface PlayerHandlers {
    onPlaybackStateChange: Optional<AudioStateChangeHandler>;
}

interface AudioChunk {
    buffer: AudioBuffer;
    chunkId: number;
}

let nextTimeMs = 0;
let lastTimeMs = 0;
let nextChunkId = 0;
let idleChunks: AudioChunk[] = [];
let durationMs = 0;

function createAudioOutput(): PlayerAudio {
    const context = new AudioContext();
    const gainNode = context.createGain();
    gainNode.connect(context.destination);

    return {
        context,
        gainNode
    };
}

function setVolume(output: PlayerAudio, volumeLevel: number): void {
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
    const playbackSlider = mountSlider("#playback-scrubber", {
        onSlide: Optional.of(handlePlaybackSlide),
        onSlideStart: Optional.empty(),
        onSlideEnd: Optional.empty()
    }).unwrap();
    const volumeSlider = mountSlider("#volume-control", {
        onSlideEnd: Optional.empty(),
        onSlideStart: Optional.empty(),
        onSlide: Optional.of((volume) => setVolume(audioOutput, volume)),
    }).unwrap();

    return Result.ok({
        playbackState: PlaybackState.Unknown,
        audioOutput,
        playbackController,
        playbackSlider,
        volumeSlider
    });
}

function addPlayerHandlers(player: Player, handlers: PlayerHandlers): Result<boolean, string> {
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

        if (!handlers.onPlaybackStateChange.isEmpty()) {
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

    if (!stateElement) {
        console.error("Failed to get playback state component");
        return;
    }

    if (!trackIdInput) {
        console.error("Failed to get track id");
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
            const trackLoader = createTrackLoader(
                player.audioOutput,
                new HubClient("http://10.0.0.142:8000"),
            );
            stateElement.textContent = "Pause";
            player.playbackState = PlaybackState.Loading;
            loadTrack(trackLoader, trackIdInput.value).then((track) => console.log(track));
            startAudioPlaybackMonitoring(player);
            break;
        case PlaybackState.Loading:
            break;
        default:
            console.error("Unhandled playback state");
            break;
    }
}

function pause(audioOutput: PlayerAudio): void {
    audioOutput.context.suspend();
}

function play(audioOutput: PlayerAudio): void {
    audioOutput.context.resume();
}

function getOutputCurrentTimeMs(output: PlayerAudio): Result<Time, string> {
    let currentTimeSeconds = output.context.getOutputTimestamp().contextTime;

    if (typeof currentTimeSeconds === "undefined") {
        return Result.error("Couldn't get current time");
    }

    return Result.ok(Time.fromUnixSeconds(currentTimeSeconds));
}

function handlePlaybackTick(player: Player): PlaybackState {
    let currentTimeResult = getOutputCurrentTimeMs(player.audioOutput);

    if (!currentTimeResult.ok()) {
        console.error("Couldn't retreive context time");
        return PlaybackState.Loading;
    }

    let currentTime = currentTimeResult.unwrap();

    if (player.playbackState != PlaybackState.Playing) {
        return player.playbackState;
    }

    let progress = currentTime.milliseconds() / durationMs;

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

function startAudioPlaybackMonitoring(player: Player) {
    const intervalId = setInterval(() => {
        switch (handlePlaybackTick(player)) {
            case PlaybackState.Error:
            case PlaybackState.Complete:
                clearInterval(intervalId);
                break;
            default:
                break;
        }
    }, 100);
}

function handlePlaybackSlide(value: number) {
    console.log(`Playback is scrubbed: ${(value * 100).toFixed(0)}%`);
}
