//! Command-line front end for reproducible, headless runs.
//!
//! ```text
//! pipesim presets <out-dir>                  export all experiment presets as JSON
//! pipesim run <config.json> [--out r.json] [--csv t.csv]
//! pipesim compare <preset-id | config.json> [--out c.json]
//! pipesim analyze <config.json>              static feasibility analysis
//! ```

use simulation_engine::experiments::{all_controllers, compare_controllers, presets};
use simulation_engine::telemetry::to_csv;
use simulation_engine::{SimulationConfig, analyze_feasibility, simulation::Simulation};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

fn usage() -> ExitCode {
    eprintln!(
        "usage:\n  pipesim presets <out-dir>\n  pipesim run <config.json> [--out results.json] [--csv telemetry.csv]\n  pipesim compare <preset-id|config.json> [--out comparison.json]\n  pipesim analyze <config.json>"
    );
    ExitCode::from(2)
}

fn flag(args: &[String], name: &str) -> Option<PathBuf> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
}

fn load_config(arg: &str) -> Result<SimulationConfig, String> {
    if let Some(p) = presets()
        .into_iter()
        .find(|p| p.id == arg || p.code.eq_ignore_ascii_case(arg))
    {
        return Ok(p.config);
    }
    let text = std::fs::read_to_string(arg).map_err(|e| format!("cannot read {arg}: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("invalid JSON: {e}"))?;
    // Accept either a bare config or a preset file ({ "config": {...} }).
    let cfg = value.get("config").cloned().unwrap_or(value);
    serde_json::from_value(cfg).map_err(|e| format!("invalid configuration: {e}"))
}

fn write(path: &Path, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| format!("cannot write {}: {e}", path.display()))
}

fn run(args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("presets") => {
            let dir = PathBuf::from(args.get(1).ok_or("missing output directory")?);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            for p in presets() {
                let path = dir.join(format!("{}.json", p.id));
                write(
                    &path,
                    &serde_json::to_string_pretty(&p).map_err(|e| e.to_string())?,
                )?;
                println!("wrote {}", path.display());
            }
            Ok(())
        }
        Some("run") => {
            let cfg = load_config(args.get(1).ok_or("missing config")?)?;
            let mut sim = Simulation::new(cfg).map_err(|e| e.to_string())?;
            sim.run_to_completion(None);
            let r = sim.results();
            println!("{}", r.report);
            if let Some(p) = flag(args, "--out") {
                write(
                    &p,
                    &serde_json::to_string_pretty(&r).map_err(|e| e.to_string())?,
                )?;
            }
            if let Some(p) = flag(args, "--csv") {
                write(&p, &to_csv(&r.telemetry))?;
            }
            Ok(())
        }
        Some("compare") => {
            let arg = args.get(1).ok_or("missing preset id or config")?;
            let (cfg, ctrls) = match presets()
                .into_iter()
                .find(|p| p.id == *arg || p.code.eq_ignore_ascii_case(arg))
            {
                Some(p) => (p.config, p.controllers),
                None => (load_config(arg)?, all_controllers()),
            };
            let c = compare_controllers(&cfg, &ctrls, None).map_err(|e| e.to_string())?;
            println!("{}", c.report);
            if let Some(p) = flag(args, "--out") {
                write(
                    &p,
                    &serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?,
                )?;
            }
            Ok(())
        }
        Some("analyze") => {
            let cfg = load_config(args.get(1).ok_or("missing config")?)?;
            let r = analyze_feasibility(&cfg).map_err(|e| e.to_string())?;
            println!("feasible: {}  (warnings: {})", r.feasible, r.has_warnings);
            if let Some(md) = &r.min_feasible_diameter {
                println!(
                    "min diameter: geometric {:.1} mm ({}), recommended {:.1} mm ({})",
                    md.geometric * 1e3,
                    md.geometric_binding,
                    md.recommended * 1e3,
                    md.recommended_binding
                );
            }
            println!(
                "min clearance {:.2} mm at s = {:.3} m; min lateral margin {:.2} mm at s = {:.3} m",
                r.min_clearance * 1e3,
                r.min_clearance_station,
                r.min_lateral_margin * 1e3,
                r.min_lateral_margin_station
            );
            for i in &r.issues {
                println!("- [{:?}] {}", i.kind, i.message);
            }
            Ok(())
        }
        _ => Err(String::new()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) if e.is_empty() => usage(),
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
