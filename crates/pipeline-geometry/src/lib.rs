//! Parametric pipeline geometry.
//!
//! A pipeline is an ordered chain of segments (straight, diameter
//! transition, circular bend). The centreline is G¹-continuous by
//! construction: every segment starts at the end pose of the previous one.
//! The centreline is parametrised by arc length `s` (m) measured from the
//! pipeline inlet.
//!
//! **Planar (developed) representation.** Bends are curves in the plane of
//! motion. Inclination is a per-segment scalar slope that enters the
//! dynamics (gravity load) and the elevation profile, but the planar
//! centreline uses the true arc length. A pipe that bends vertically is
//! therefore not represented geometrically – see docs/limitations.md.

mod model;
mod pipeline;

pub use model::{
    MAX_DIAMETER, MAX_INCLINATION_DEG, MIN_DIAMETER, PipelineConfig, Restriction, SegmentConfig,
    SegmentGeometry, TransitionProfile,
};
pub use pipeline::{
    Discontinuity, DiscontinuityKind, GeometrySample, Pipeline, PipelineSummary, Projection,
    ResolvedSegment,
};
