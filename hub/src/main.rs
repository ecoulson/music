use std::{fs::File, io::Read};

use hub::{
    hub_server::{Hub, HubServer},
    GetTrackListRequest, GetTrackListResponse, StreamAudioRequest, StreamAudioResponse, Track,
};
use r2d2::{ManageConnection, Pool, PooledConnection};
use sqlite::Connection;
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

struct SqliteConnectionManager {}

impl ManageConnection for SqliteConnectionManager {
    type Error = sqlite::Error;
    type Connection = Connection;

    fn connect(&self) -> Result<Self::Connection, Self::Error> {
        sqlite::Connection::open("hub")
    }

    fn is_valid(&self, conn: &mut Self::Connection) -> Result<(), Self::Error> {
        conn.execute("")
    }

    fn has_broken(&self, _: &mut Self::Connection) -> bool {
        false
    }
}

pub struct HubService {
    connection_pool: Pool<SqliteConnectionManager>,
}

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

    async fn get_track_list(
        &self,
        _request: Request<GetTrackListRequest>,
    ) -> Result<Response<GetTrackListResponse>, Status> {
        Ok(Response::new(GetTrackListResponse {
            tracks: vec![Track {
                track_id: String::from("0"),
                track_path: String::from(""),
            }],
        }))
    }
}

fn initialize_schema(connection: PooledConnection<SqliteConnectionManager>) {
    connection
        .execute(
            "CREATE TABLE IF NOT EXISTS Tracks (
                TrackId VARCHAR(128),
                TrackPath VARCHAR(256)
            )",
        )
        .expect("Should create table");
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address = "0.0.0.0:8000".parse()?;
    let connection_pool = Pool::new(SqliteConnectionManager {}).expect("Create connection");
    initialize_schema(connection_pool.get().expect("Create schema"));
    let hub_service = HubService { connection_pool };
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
    use r2d2::Pool;
    use std::fs;
    use tokio_stream::StreamExt;
    use tonic::Request;

    use crate::{
        hub::{hub_server::Hub, StreamAudioRequest},
        HubService, SqliteConnectionManager,
    };

    #[tokio::test]
    async fn should_stream_file() {
        let service = HubService {
            connection_pool: Pool::new(SqliteConnectionManager {}).expect("Should create pool"),
        };
        let expected_buffer = fs::read("/home/ecoulson/Code/music/test_audio/test.mp3").unwrap();

        let mut response = service
            .stream_audio(Request::new(StreamAudioRequest {
                track_id: String::new(),
            }))
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
