//! Small deterministic PRNG (SplitMix64) with Gaussian sampling.
//!
//! Implemented locally so that results are bit-for-bit reproducible across
//! platforms and independent of third-party crate version changes.

#[derive(Clone, Debug)]
pub struct Rng {
    state: u64,
    spare: Option<f64>,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self {
            state: seed,
            spare: None,
        }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform sample in the open interval (0, 1).
    pub fn uniform(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64 + 0.5) / (1u64 << 53) as f64
    }

    /// Standard normal sample (Box–Muller transform).
    pub fn gaussian(&mut self) -> f64 {
        if let Some(s) = self.spare.take() {
            return s;
        }
        let u1 = self.uniform();
        let u2 = self.uniform();
        let r = (-2.0 * u1.ln()).sqrt();
        let (s, c) = (2.0 * std::f64::consts::PI * u2).sin_cos();
        self.spare = Some(r * s);
        r * c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_and_reasonable_moments() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        let n = 20_000;
        let (mut sum, mut sum2) = (0.0, 0.0);
        for _ in 0..n {
            let x = a.gaussian();
            assert_eq!(x, b.gaussian());
            sum += x;
            sum2 += x * x;
        }
        let mean = sum / n as f64;
        let var = sum2 / n as f64 - mean * mean;
        assert!(mean.abs() < 0.03, "{mean}");
        assert!((var - 1.0).abs() < 0.05, "{var}");
    }
}
