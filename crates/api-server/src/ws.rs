//! WebSocket telemetry stream: `GET /api/simulations/{id}/ws`.
//!
//! Server → client messages (JSON, tagged by `type`):
//! * `snapshot`  – status snapshot (+ playback speed), sent on every frame;
//! * `telemetry` – new samples `{ from, samples }`; `from` is the index of
//!   the first sample so clients can detect resets (from = 0) and gaps;
//! * `events`    – full list of constraint-violation episodes when it changes.
//!
//! Each connection tracks how many samples it has delivered, so a slow
//! client never loses data (it simply receives larger batches). A reset of
//! the simulation is detected when the telemetry length shrinks.

use crate::error::ApiError;
use crate::state::{AppState, SimEntry};
use axum::extract::ws::{Message, Utf8Bytes, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use simulation_engine::{StatusSnapshot, TelemetrySample, ViolationEvent};
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

const MAX_BATCH: usize = 2000;

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WsMessage<'a> {
    Snapshot {
        id: Uuid,
        playback_speed: f64,
        snapshot: &'a StatusSnapshot,
    },
    Telemetry {
        from: usize,
        samples: &'a [TelemetrySample],
    },
    Events {
        events: &'a [ViolationEvent],
    },
}

pub async fn ws_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let uuid = Uuid::parse_str(&id).map_err(|_| ApiError::bad_request("invalid simulation id"))?;
    let entry = state
        .get(&uuid)
        .ok_or_else(|| ApiError::not_found(&format!("simulation {uuid}")))?;
    Ok(ws.on_upgrade(move |socket| stream(socket, entry)))
}

fn encode(msg: &WsMessage<'_>) -> Option<Message> {
    serde_json::to_string(msg)
        .ok()
        .map(|s| Message::Text(Utf8Bytes::from(s)))
}

async fn stream(socket: WebSocket, entry: Arc<SimEntry>) {
    let (mut tx, mut rx) = socket.split();
    let mut frames = entry.subscribe();
    let mut sent = 0usize;
    let mut sent_events = usize::MAX;

    loop {
        // Collect everything to send while holding the lock, then release it
        // before awaiting on the socket.
        let mut out: Vec<Message> = Vec::new();
        {
            let sim = entry.lock();
            let snap = sim.snapshot();
            let tel = sim.telemetry();
            if tel.len() < sent {
                sent = 0; // simulation was reset
                sent_events = usize::MAX;
            }
            while sent < tel.len() {
                let end = (sent + MAX_BATCH).min(tel.len());
                if let Some(m) = encode(&WsMessage::Telemetry {
                    from: sent,
                    samples: &tel[sent..end],
                }) {
                    out.push(m);
                }
                sent = end;
            }
            let events = sim.events();
            if events.len() != sent_events {
                if let Some(m) = encode(&WsMessage::Events { events }) {
                    out.push(m);
                }
                sent_events = events.len();
            }
            // The snapshot is small; it is sent on every frame and heartbeat.
            if let Some(m) = encode(&WsMessage::Snapshot {
                id: entry.id,
                playback_speed: entry.playback(),
                snapshot: &snap,
            }) {
                out.push(m);
            }
        }
        for m in out {
            if tx.send(m).await.is_err() {
                return;
            }
        }

        tokio::select! {
            changed = frames.changed() => {
                if changed.is_err() {
                    return; // simulation removed
                }
            }
            // Heartbeat so idle clients still see status/playback changes.
            _ = tokio::time::sleep(Duration::from_millis(1000)) => {}
            incoming = rx.next() => {
                match incoming {
                    None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return,
                    Some(Ok(_)) => {} // commands go through REST; ignore
                }
            }
        }
    }
}
