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
    <h1>player</h1>
    <script src="assets/web-player.js"></script>
    "#,
    ext = "html"
)]
struct PlayerComponent {}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/get_player", axum::routing::get(get_player))
        .nest_service("/assets", ServeDir::new("assets"));
    let listener = TcpListener::bind("0.0.0.0:8080").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn get_player() -> impl IntoResponse {
    PlayerComponent {}
}
