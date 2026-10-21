//! Typed API errors with a consistent JSON body:
//!
//! ```json
//! { "error": { "code": "validation_failed", "message": "...", "details": [ { "field": "...", "message": "..." } ] } }
//! ```

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use robot_core::{ValidationErrors, ValidationIssue};
use serde::Serialize;
use simulation_engine::SimError;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    pub details: Vec<ValidationIssue>,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: ErrorPayload<'a>,
}

#[derive(Serialize)]
struct ErrorPayload<'a> {
    code: &'a str,
    message: &'a str,
    details: &'a [ValidationIssue],
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            details: Vec::new(),
        }
    }

    pub fn not_found(what: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("{what} not found"),
        )
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "bad_request", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal_error", message)
    }
}

impl From<ValidationErrors> for ApiError {
    fn from(e: ValidationErrors) -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            code: "validation_failed",
            message: e.to_string(),
            details: e.issues,
        }
    }
}

impl From<SimError> for ApiError {
    fn from(e: SimError) -> Self {
        match e {
            SimError::Validation(v) => v.into(),
            SimError::InvalidTransition { .. } => Self::new(
                StatusCode::CONFLICT,
                "invalid_state_transition",
                e.to_string(),
            ),
        }
    }
}

impl From<JsonRejection> for ApiError {
    fn from(r: JsonRejection) -> Self {
        let status = r.status();
        let code = if status == StatusCode::UNSUPPORTED_MEDIA_TYPE {
            "unsupported_media_type"
        } else {
            "invalid_json"
        };
        Self::new(
            if status == StatusCode::UNSUPPORTED_MEDIA_TYPE {
                status
            } else {
                StatusCode::BAD_REQUEST
            },
            code,
            r.body_text(),
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ErrorBody {
            error: ErrorPayload {
                code: self.code,
                message: &self.message,
                details: &self.details,
            },
        };
        (self.status, Json(body)).into_response()
    }
}

/// JSON extractor whose rejections use the API error format.
#[derive(axum::extract::FromRequest)]
#[from_request(via(axum::Json), rejection(ApiError))]
pub struct ApiJson<T>(pub T);

pub type ApiResult<T> = Result<T, ApiError>;
