import { Optional } from "./optional";
import { mountPlayer } from "./player";

mountPlayer("#player-component", {
    onPlaybackStateChange: Optional.empty()
}).unwrap();
