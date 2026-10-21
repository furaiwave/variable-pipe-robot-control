//! Structured validation errors shared by all crates.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ValidationIssue {
    /// Dotted path of the offending field, e.g. `robot.wheel_radius`.
    pub field: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, thiserror::Error)]
#[error("configuration is invalid: {}", summary(.issues))]
pub struct ValidationErrors {
    pub issues: Vec<ValidationIssue>,
}

fn summary(issues: &[ValidationIssue]) -> String {
    issues
        .iter()
        .take(3)
        .map(|i| format!("{}: {}", i.field, i.message))
        .collect::<Vec<_>>()
        .join("; ")
}

impl ValidationErrors {
    pub fn single(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            issues: vec![ValidationIssue {
                field: field.into(),
                message: message.into(),
            }],
        }
    }
}

/// Small helper that accumulates issues under a field prefix.
#[derive(Debug, Default)]
pub struct Validator {
    prefix: String,
    issues: Vec<ValidationIssue>,
}

impl Validator {
    pub fn new(prefix: impl Into<String>) -> Self {
        Self {
            prefix: prefix.into(),
            issues: Vec::new(),
        }
    }

    fn path(&self, field: &str) -> String {
        if self.prefix.is_empty() {
            field.to_string()
        } else if field.is_empty() {
            self.prefix.clone()
        } else {
            format!("{}.{}", self.prefix, field)
        }
    }

    pub fn push(&mut self, field: &str, message: impl Into<String>) {
        let path = self.path(field);
        self.issues.push(ValidationIssue {
            field: path,
            message: message.into(),
        });
    }

    /// Requires a finite number. Returns `true` when it is finite.
    pub fn finite(&mut self, field: &str, v: f64) -> bool {
        if v.is_finite() {
            true
        } else {
            self.push(field, "must be a finite number");
            false
        }
    }

    pub fn positive(&mut self, field: &str, v: f64) {
        if self.finite(field, v) && v <= 0.0 {
            self.push(field, format!("must be greater than 0 (got {v})"));
        }
    }

    pub fn non_negative(&mut self, field: &str, v: f64) {
        if self.finite(field, v) && v < 0.0 {
            self.push(field, format!("must be ≥ 0 (got {v})"));
        }
    }

    /// Inclusive range check.
    pub fn range(&mut self, field: &str, v: f64, min: f64, max: f64) {
        if self.finite(field, v) && (v < min || v > max) {
            self.push(field, format!("must be within [{min}, {max}] (got {v})"));
        }
    }

    pub fn check(&mut self, cond: bool, field: &str, message: impl Into<String>) {
        if !cond {
            self.push(field, message);
        }
    }

    pub fn merge(&mut self, other: ValidationErrors) {
        self.issues.extend(other.issues);
    }

    pub fn has_issues(&self) -> bool {
        !self.issues.is_empty()
    }

    pub fn finish(self) -> Result<(), ValidationErrors> {
        if self.issues.is_empty() {
            Ok(())
        } else {
            Err(ValidationErrors {
                issues: self.issues,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_nan_and_negative() {
        let mut v = Validator::new("robot");
        v.positive("a", f64::NAN);
        v.positive("b", -1.0);
        v.positive("c", 1.0);
        v.range("d", 5.0, 0.0, 1.0);
        let err = v.finish().unwrap_err();
        assert_eq!(err.issues.len(), 3);
        assert_eq!(err.issues[0].field, "robot.a");
    }
}
