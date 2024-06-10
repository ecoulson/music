use std::{collections::HashMap, str::FromStr};

use hub::{hub_client::HubClient, GetTrackListRequest};
use player::PlayerState;
use tokio::net::TcpListener;

use askama_axum::Template;
use axum::{
    extract::Path,
    http::{HeaderMap, HeaderName, HeaderValue},
    response::IntoResponse,
    Router,
};
use tower_http::services::ServeDir;

pub mod player {
    tonic::include_proto!("player");
}

pub mod hub {
    tonic::include_proto!("hub");
}

#[derive(Template)]
#[template(path = "home.html")]
struct HomePage {
    track_list: TrackListComponent,
    player_state: PlayerState,
}

#[derive(Template)]
#[template(
    source = r##"
    <div>
        {% for element in tracks %}
        {{ element|safe }}
        {% endfor %}
    </div>
    "##,
    ext = "html"
)]
struct TrackListComponent {
    tracks: Vec<TrackListElement>,
}

#[derive(Template)]
#[template(
    source = r##"
    <div hx-trigger="click" hx-post="/change_track/{{ hub_id }}/{{ track_id }}">
        Track
    </div>
    "##,
    ext = "html"
)]
struct TrackListElement {
    track_id: String,
    hub_id: String,
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .nest_service("/assets", ServeDir::new("assets"))
        .nest_service("/vendors", ServeDir::new("vendors"))
        .route("/", axum::routing::get(render_home_page))
        .route(
            "/change_track/:hub_id/:track_id",
            axum::routing::post(change_track),
        );
    let listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn render_home_page() -> impl IntoResponse {
    let mut hub_client = HubClient::connect("http://0.0.0.0:8000")
        .await
        .expect("Should connect to hub");
    let track_list = hub_client
        .get_track_list(GetTrackListRequest {
            track_ids: vec![String::from("")],
        })
        .await
        .expect("Should get tracklist")
        .into_inner();
    let track_list_elements = track_list
        .tracks
        .iter()
        .map(|track| TrackListElement {
            track_id: track.track_id.clone(),
            hub_id: track.hub_id.clone(),
        })
        .collect();

    HomePage {
        track_list: TrackListComponent {
            tracks: track_list_elements,
        },
        player_state: PlayerState {
            track_id: String::new(),
            hub_id: String::new(),
            gain: 100,
        },
    }
}

async fn change_track(Path((hub_id, track_id)): Path<(String, String)>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    let events = HashMap::from([(
        "player_state_change",
        PlayerState {
            hub_id,
            track_id,
            gain: 100,
        },
    )]);
    headers.insert(
        HeaderName::from_str("HX-Reswap").unwrap(),
        HeaderValue::from_str("none").unwrap(),
    );
    headers.insert(
        HeaderName::from_str("HX-Trigger").unwrap(),
        HeaderValue::from_str(&serde_json::to_string(&events).unwrap()).unwrap(),
    );

    headers
}
