use hub::{hub_client::HubClient, GetTrackListRequest};
use tokio::net::TcpListener;

use askama_axum::Template;
use axum::{extract::Path, response::IntoResponse, Router};
use tower_http::services::ServeDir;

pub mod hub {
    tonic::include_proto!("hub");
}

#[derive(Template)]
#[template(path = "home.html")]
struct HomePage {
    track_list: TrackListComponent,
    player: PlayerComponent,
}

#[derive(Template)]
#[template(path = "player.html")]
struct PlayerComponent {
    state: PlayerStateComponent,
    gain: usize,
    playback_state: Option<String>
}

#[derive(Template)]
#[template(path = "player_state.html")]
struct PlayerStateComponent {
    track_id: String,
    hub_id: String,
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
    <div hx-trigger="click" hx-swap="innerHTML" hx-target="#player-component-state" 
        hx-post="/change_track/{{hub_id}}/{{ track_id }}">
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
        player: PlayerComponent {
            state: PlayerStateComponent {
                track_id: String::new(),
                hub_id: String::new(),
            },
            gain: 100,
        },
    }
}

async fn change_track(Path((hub_id, track_id)): Path<(String, String)>) -> impl IntoResponse {
    PlayerStateComponent { track_id, hub_id }
}
