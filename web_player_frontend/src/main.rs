use tokio::net::TcpListener;

use askama_axum::Template;
use axum::{response::IntoResponse, Router};
use tower_http::services::ServeDir;

pub mod hub {
    tonic::include_proto!("hub");
}

#[derive(Template)]
#[template(
    source = r#"
    {{ song_list|safe }}
    {{ player|safe }}
    <script src="vendors/htmx.min.js"></script>
    <script src="assets/web-player.js"></script>
    "#,
    ext = "html"
)]
struct HomePage {
    song_list: SongListComponent,
    player: PlayerComponent,
}

#[derive(Template)]
#[template(
    source = r#"
    <div id="player-component">
        <input id="playback-song-id" value="{{ song_id }}" hidden />
        <button id="playback-controller">Play</button>
    </div>
    "#,
    ext = "html"
)]
struct PlayerComponent {
    song_id: String,
}

#[derive(Template)]
#[template(
    source = r##"
    <div id="song-0" hx-trigger="click" hx-target="#player-component" hx-post="/get_player/0">Song 1</div>
    "##,
    ext = "html"
)]
struct SongListComponent {}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/", axum::routing::get(render_home_page))
        .route("/get_player/:player_id", axum::routing::post(get_player))
        .route("/list_songs", axum::routing::post(list_songs))
        .nest_service("/assets", ServeDir::new("assets"))
        .nest_service("/vendors", ServeDir::new("vendors"));
    let listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn render_home_page() -> impl IntoResponse {
    HomePage {
        song_list: SongListComponent {},
        player: PlayerComponent {
            song_id: String::new(),
        },
    }
}

async fn list_songs() -> impl IntoResponse {
    SongListComponent {}
}

async fn get_player(song_id: String) -> impl IntoResponse {
    PlayerComponent { song_id }
}
