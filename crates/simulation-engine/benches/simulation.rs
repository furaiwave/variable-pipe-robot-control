//! Criterion benchmarks of the computationally intensive parts.
//!
//! Run with `cargo bench -p simulation-engine`.

use criterion::{Criterion, criterion_group, criterion_main};
use pipeline_geometry::Pipeline;
use robot_core::Vec2;
use robot_core::envelope::RobotEnvelope;
use simulation_engine::collision::ClearanceModel;
use simulation_engine::experiments::presets;
use simulation_engine::{SimulationConfig, simulation::Simulation};
use std::hint::black_box;

fn bench_projection(c: &mut Criterion) {
    let cfg = SimulationConfig::default();
    let p = Pipeline::new(cfg.pipeline.clone()).unwrap();
    c.bench_function("centreline projection (windowed)", |b| {
        b.iter(|| black_box(p.project(black_box(Vec2::new(2.3, 0.4)), Some((2.5, 0.4)))))
    });
}

fn bench_clearance(c: &mut Criterion) {
    let cfg = SimulationConfig::default();
    let p = Pipeline::new(cfg.pipeline.clone()).unwrap();
    let env = RobotEnvelope::new(&cfg.robot);
    let m = ClearanceModel {
        pipeline: &p,
        robot: &cfg.robot,
        envelope: &env,
        safety_margin: 0.005,
    };
    let pose = m.aligned_pose(2.4, 0.003, 0.02);
    c.bench_function("clearance evaluation (one pose)", |b| {
        b.iter(|| black_box(m.evaluate(black_box(pose), 2.4)))
    });
}

fn bench_full_run(c: &mut Criterion) {
    let cfg = presets()
        .into_iter()
        .find(|p| p.code == "F")
        .unwrap()
        .config;
    let mut g = c.benchmark_group("full run");
    g.sample_size(10);
    g.bench_function("experiment F, PID, to completion", |b| {
        b.iter(|| {
            let mut sim = Simulation::new(cfg.clone()).unwrap();
            black_box(sim.run_to_completion(None))
        })
    });
    g.finish();
}

criterion_group!(benches, bench_projection, bench_clearance, bench_full_run);
criterion_main!(benches);
