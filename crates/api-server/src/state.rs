//! Simulation registry and real-time runner tasks.
//!
//! Each live simulation is owned by the server (`Arc<SimEntry>`). While a
//! simulation is `Running` a background task advances it in wall-clock
//! paced chunks: every tick (≈ 30 Hz) it computes how much *simulated* time
//! should elapse (`playback_speed × wall time`) and executes the
//! corresponding number of fixed steps. Physics therefore does not depend on
//! tick jitter or client rendering; only the pacing does. A per-tick CPU
//! budget keeps very high playback speeds from starving the runtime.

use simulation_engine::{Simulation, SimulationConfig, SimulationStatus};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;
use uuid::Uuid;

pub const TICK: Duration = Duration::from_millis(33);
pub const TICK_BUDGET: Duration = Duration::from_millis(20);
pub const MAX_SIMULATIONS: usize = 64;
pub const MIN_PLAYBACK: f64 = 0.05;
pub const MAX_PLAYBACK: f64 = 1000.0;

pub struct SimEntry {
    pub id: Uuid,
    pub created_at_ms: u64,
    sim: Mutex<Simulation>,
    playback_bits: AtomicU64,
    runner_active: AtomicBool,
    pub cancel: AtomicBool,
    frame_tx: watch::Sender<u64>,
}

impl SimEntry {
    pub fn lock(&self) -> MutexGuard<'_, Simulation> {
        // A poisoned lock only means a previous holder panicked; the
        // simulation state itself is still consistent between steps.
        self.sim.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn playback(&self) -> f64 {
        f64::from_bits(self.playback_bits.load(Ordering::Relaxed))
    }

    pub fn set_playback(&self, v: f64) {
        self.playback_bits.store(
            v.clamp(MIN_PLAYBACK, MAX_PLAYBACK).to_bits(),
            Ordering::Relaxed,
        );
    }

    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.frame_tx.subscribe()
    }

    /// Notify WebSocket subscribers that new data is available.
    pub fn notify(&self) {
        self.frame_tx.send_modify(|v| *v = v.wrapping_add(1));
    }
}

#[derive(Clone)]
pub struct AppState {
    inner: Arc<RwLock<Registry>>,
    pub started: Instant,
}

#[derive(Default)]
struct Registry {
    sims: HashMap<Uuid, Arc<SimEntry>>,
    order: Vec<Uuid>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(Registry::default())),
            started: Instant::now(),
        }
    }

    pub fn insert(&self, sim: Simulation, playback: f64) -> Arc<SimEntry> {
        let id = Uuid::new_v4();
        let (frame_tx, _) = watch::channel(0);
        let entry = Arc::new(SimEntry {
            id,
            created_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_millis() as u64),
            sim: Mutex::new(sim),
            playback_bits: AtomicU64::new(playback.clamp(MIN_PLAYBACK, MAX_PLAYBACK).to_bits()),
            runner_active: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
            frame_tx,
        });
        let mut reg = self.inner.write().unwrap_or_else(|p| p.into_inner());
        // Evict the oldest finished simulations beyond the capacity.
        while reg.order.len() >= MAX_SIMULATIONS {
            let victim = reg.order.iter().position(|id| {
                reg.sims.get(id).is_none_or(|e| {
                    let st = e.lock().status();
                    st.is_terminal() || st == SimulationStatus::Ready
                })
            });
            match victim {
                Some(i) => {
                    let id = reg.order.remove(i);
                    reg.sims.remove(&id);
                }
                None => break,
            }
        }
        reg.sims.insert(id, entry.clone());
        reg.order.push(id);
        entry
    }

    pub fn get(&self, id: &Uuid) -> Option<Arc<SimEntry>> {
        self.inner
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .sims
            .get(id)
            .cloned()
    }

    pub fn remove(&self, id: &Uuid) -> Option<Arc<SimEntry>> {
        let mut reg = self.inner.write().unwrap_or_else(|p| p.into_inner());
        reg.order.retain(|x| x != id);
        reg.sims.remove(id)
    }

    pub fn list(&self) -> Vec<Arc<SimEntry>> {
        let reg = self.inner.read().unwrap_or_else(|p| p.into_inner());
        reg.order
            .iter()
            .filter_map(|id| reg.sims.get(id).cloned())
            .collect()
    }

    pub fn create(
        &self,
        config: SimulationConfig,
        playback: f64,
    ) -> Result<Arc<SimEntry>, simulation_engine::SimError> {
        let sim = Simulation::new(config)?;
        Ok(self.insert(sim, playback))
    }
}

/// Ensure a paced runner task exists for `entry` (idempotent).
pub fn ensure_runner(entry: Arc<SimEntry>) {
    if entry.runner_active.swap(true, Ordering::AcqRel) {
        return;
    }
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(TICK);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut last = Instant::now();
        loop {
            interval.tick().await;
            let now = Instant::now();
            // Cap the wall-time increment so a stalled runtime does not
            // cause a large jump in simulated time.
            let wall = now
                .duration_since(last)
                .min(Duration::from_millis(250))
                .as_secs_f64();
            last = now;
            let keep_going = {
                let mut sim = entry.lock();
                if entry.cancel.load(Ordering::Relaxed) && !sim.status().is_terminal() {
                    let _ = sim.stop();
                }
                if sim.status() == SimulationStatus::Running {
                    let target = sim.time() + entry.playback() * wall;
                    sim.run_until(target, Some(TICK_BUDGET));
                }
                sim.status() == SimulationStatus::Running
            };
            entry.notify();
            if !keep_going {
                break;
            }
        }
        entry.runner_active.store(false, Ordering::Release);
        // A resume may have raced with the shutdown of this task.
        if entry.lock().status() == SimulationStatus::Running {
            ensure_runner(entry);
        }
    });
}
