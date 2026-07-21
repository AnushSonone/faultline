//! WebSocket session stream.

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::broadcast;

use crate::sessions::SharedState;
use faultline_projection::WsEnvelope;

pub const PROTOCOL_VERSION: u16 = faultline_projection::PROTOCOL_VERSION;

pub async fn stream_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
    Path(session_id): Path<String>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state, session_id))
}

async fn handle_socket(socket: WebSocket, state: SharedState, session_id: String) {
    let (mut sink, mut stream) = socket.split();

    let prepared = {
        let mut sessions = state.sessions.lock();
        match sessions.get_mut(&session_id) {
            None => None,
            Some(session) => {
                session.emit(
                    "session.ready",
                    json!({
                        "session_id": session_id,
                        "incident_id": session.incident_id,
                        "event_count": session.envelopes.len(),
                    }),
                );
                session.publish_projections();
                Some(session.subscribe())
            }
        }
    };

    let Some(mut rx) = prepared else {
        let _ = sink
            .send(Message::Text(
                json!({"error": "session not found"}).to_string().into(),
            ))
            .await;
        return;
    };

    let send_task = tokio::spawn(async move {
        forward_broadcast(&mut sink, &mut rx).await;
    });

    while let Some(Ok(msg)) = stream.next().await {
        if matches!(msg, Message::Close(_)) {
            break;
        }
    }

    send_task.abort();
}

async fn forward_broadcast(
    sink: &mut futures::stream::SplitSink<WebSocket, Message>,
    rx: &mut broadcast::Receiver<WsEnvelope>,
) {
    while let Ok(env) = rx.recv().await {
        let text = match serde_json::to_string(&env) {
            Ok(t) => t,
            Err(_) => continue,
        };
        if sink.send(Message::Text(text.into())).await.is_err() {
            break;
        }
    }
}
