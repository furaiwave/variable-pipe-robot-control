//! Deterministic simulation engine for an in-pipe wheeled robot.
//!
//! Module overview:
//! * [`config`]      – experiment / simulation configuration and validation
//! * [`collision`]   – quasi-3D clearance evaluation of the robot in the pipe
//! * [`analysis`]    – static feasibility analysis (profile, steps, D_min)
//! * [`reference`]   – reference trajectory generator along the centreline
//! * [`simulation`]  – fixed-step loop and lifecycle state machine
//! * [`telemetry`]   – samples, constraint-violation events, CSV export
//! * [`metrics`]     – performance metrics (RMSE, MAE, …)
//! * [`experiments`] – predefined experiments A–F and controller comparison
//! * [`report`]      – automatically generated textual reports

pub mod analysis;
pub mod collision;
pub mod config;
pub mod experiments;
pub mod metrics;
pub mod reference;
pub mod report;
pub mod rng;
pub mod simulation;
pub mod telemetry;

pub use analysis::{
    FeasibilityReport, analyze_feasibility, cross_section_view, min_feasible_diameter,
};
pub use config::{Disturbances, InitialConditions, ReferenceConfig, SimulationConfig};
pub use experiments::{ComparisonResult, ExperimentPreset, compare_controllers, presets};
pub use metrics::{ErrorStats, PerformanceMetrics};
pub use simulation::{
    FailureInfo, SimError, Simulation, SimulationResults, SimulationStatus, StatusSnapshot,
};
pub use telemetry::{Severity, TelemetrySample, ViolationEvent, ViolationKind};

/// Version string embedded in exported results for reproducibility.
pub const ENGINE_VERSION: &str = concat!("simulation-engine ", env!("CARGO_PKG_VERSION"));
