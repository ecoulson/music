import { HubClient } from "../generated/HubServiceClientPb";
import { StreamAudioRequest, StreamAudioResponse } from "../generated/hub_pb";

const service = new HubClient("http://localhost:8000", null, null);

const request = new StreamAudioRequest();

const stream = service.streamAudio(request, {});
stream.on('data', function(response: StreamAudioResponse) {
    console.log(response);
});

