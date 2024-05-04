use std::{fs::File, io::Read};

use hub::{
    hub_server::{Hub, HubServer},
    StreamAudioRequest, StreamAudioResponse,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{transport::Server, Request, Response, Status};
use tower_http::cors::CorsLayer;

const ONE_MB: usize = 1048576;

pub mod hub {
    tonic::include_proto!("hub");
}

struct ChunkedReader<T> {
    source: T,
}

impl<T> ChunkedReader<T>
where
    T: Read,
{
    fn new(source: T) -> ChunkedReader<T> {
        ChunkedReader { source }
    }
}

impl<T> Iterator for ChunkedReader<T>
where
    T: Read,
{
    type Item = Vec<u8>;

    fn next(&mut self) -> Option<Self::Item> {
        let mut buffer = [0; ONE_MB];

        match self.source.read(&mut buffer) {
            Ok(0) => None,
            Ok(size) => Some(buffer[..size].to_vec()),
            Err(_) => None,
        }
    }
}

#[derive(Debug, Default)]
pub struct HubService {}

#[tonic::async_trait]
impl Hub for HubService {
    type StreamAudioStream = ReceiverStream<Result<StreamAudioResponse, Status>>;

    async fn stream_audio(
        &self,
        _request: Request<StreamAudioRequest>,
    ) -> Result<Response<Self::StreamAudioStream>, Status> {
        let (sender, receiver) = tokio::sync::mpsc::channel(128);
        let file = File::open("/home/ecoulson/Code/music/test_audio/test.mp3")?;

        tokio::spawn(async move {
            let reader = ChunkedReader::new(file);
            let mut chunk_id = 0;

            for chunk in reader {
                sender
                    .send(Ok(StreamAudioResponse { chunk_id, chunk }))
                    .await
                    .expect("Should stream chunk in order");
                chunk_id += 1;
            }
        });

        Ok(Response::new(ReceiverStream::new(receiver)))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address = "0.0.0.0:8000".parse()?;
    let hub_service = HubService::default();
    let hub = HubServer::new(hub_service);

    Server::builder()
        .accept_http1(true)
        .layer(CorsLayer::permissive())
        .add_service(tonic_web::enable(hub))
        .serve(address)
        .await?;

    Ok(())
}

#[cfg(test)]
pub mod tests {
    use std::fs;
    use tokio_stream::StreamExt;
    use tonic::Request;

    use crate::{
        hub::{hub_server::Hub, StreamAudioRequest},
        HubService,
    };

    #[tokio::test]
    async fn should_stream_file() {
        let service = HubService::default();
        let expected_buffer = fs::read("/home/ecoulson/Code/music/test_audio/test.mp3").unwrap();

        let mut response = service
            .stream_audio(Request::new(StreamAudioRequest {}))
            .await
            .unwrap()
            .into_inner();
        let mut actual_buffer: Vec<u8> = vec![];
        while let Some(message) = response.next().await {
            actual_buffer.append(&mut message.unwrap().chunk);
        }

        assert_eq!(actual_buffer, expected_buffer);
    }
}
