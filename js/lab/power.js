// Stats Lab: power and sample size math. Pure functions, no DOM.
//
// Every formula here follows a chapter of the NCSS PASS documentation and is
// checked against the worked examples printed in that chapter
// (see tests/lab.test.html).
//
//   Cox regression        PASS chapter 850, "Cox Regression"
//                         Hsieh and Lavori (2000); Schoenfeld (1983)
//   Logistic regression   PASS chapter 860, "Logistic Regression (Legacy)"
//                         Hsieh, Bloch and Larsen (1998)
//   One ROC curve (AUC)   PASS chapter 260, "Tests for One ROC Curve"
//                         Hanley and McNeil variance (continuous data),
//                         Obuchowski and McClish (1997) variance (rating data)
//
// Conventions
//   alpha   total type I error. sides = 2 (default) splits it in two tails.
//   power   1 - beta.
//   Each "N" solver returns the unrounded value in `raw` and the value
//   rounded up to the next whole subject in the integer fields.
//   Power for a two-sided test counts the tail in the direction of the
//   effect only, as PASS does.
(function (root) {
  'use strict';

  // ---------- normal distribution ----------

  // Standard normal CDF. Hart's double-precision algorithm as given by
  // West (2005), "Better approximations to cumulative normal functions".
  // Absolute error is below 1e-15 across the real line.
  function pnorm(z) {
    if (z !== z) return NaN;
    var x = Math.abs(z), c;
    if (x > 37) {
      c = 0;
    } else {
      var e = Math.exp(-x * x / 2), b;
      if (x < 7.07106781186547) {
        b = 3.52624965998911e-02 * x + 0.700383064443688;
        b = b * x + 6.37396220353165;
        b = b * x + 33.912866078383;
        b = b * x + 112.079291497871;
        b = b * x + 221.213596169931;
        b = b * x + 220.206867912376;
        c = e * b;
        b = 8.83883476483184e-02 * x + 1.75566716318264;
        b = b * x + 16.064177579207;
        b = b * x + 86.7807322029461;
        b = b * x + 296.564248779674;
        b = b * x + 637.333633378831;
        b = b * x + 793.826512519948;
        b = b * x + 440.413735824752;
        c = c / b;
      } else {
        b = x + 0.65;
        b = x + 4 / b;
        b = x + 3 / b;
        b = x + 2 / b;
        b = x + 1 / b;
        c = e / b / 2.506628274631;
      }
    }
    return z > 0 ? 1 - c : c;
  }

  function dnorm(z) { return Math.exp(-z * z / 2) / 2.5066282746310002; }

  // Inverse standard normal CDF. Acklam's rational approximation
  // (relative error about 1.15e-9) followed by one Halley step against
  // pnorm above, which brings it to full double precision.
  function qnorm(p) {
    if (p !== p || p < 0 || p > 1) return NaN;
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
    var lo = 0.02425, q, r, x;
    if (p < lo) {
      q = Math.sqrt(-2 * Math.log(p));
      x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
          ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    } else if (p <= 1 - lo) {
      q = p - 0.5; r = q * q;
      x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
          (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    var err = pnorm(x) - p;
    var u = err / dnorm(x);
    return x - u / (1 + x * u / 2);
  }

  // ---------- helpers ----------

  function def(v, d) { return v === undefined || v === null ? d : v; }
  function zAlpha(o) { return qnorm(1 - def(o.alpha, 0.05) / def(o.sides, 2)); }
  function zBeta(o) { return qnorm(o.power); }
  // Round up to a whole subject, forgiving floating-point dust.
  function up(x) { return Math.ceil(x - 1e-9); }
  function oddsToP1(p0, or) { var odds = or * p0 / (1 - p0); return odds / (1 + odds); }

  // ---------- Cox regression: Hsieh and Lavori (2000), PASS ch. 850 ----------
  // D = (z_{1-a/2} + z_{1-b})^2 / [(1 - R2) sigma^2 B^2],  N = D / P
  // o: { hr | b, sigma, r2, eventRate, alpha, sides, power }
  function coxB(o) { return o.b !== undefined ? o.b : Math.log(o.hr); }

  function coxEvents(o) {
    var B = coxB(o), s = def(o.sigma, 0.5), r2 = def(o.r2, 0);
    var z = zAlpha(o) + zBeta(o);
    var raw = z * z / ((1 - r2) * s * s * B * B);
    return { raw: raw, events: up(raw) };
  }

  function coxN(o) {
    var d = coxEvents(o), P = def(o.eventRate, 1);
    var raw = d.raw / P;
    return { raw: raw, n: up(raw), eventsRaw: d.raw, events: d.events };
  }

  function coxPower(o) {
    var B = Math.abs(coxB(o)), s = def(o.sigma, 0.5), r2 = def(o.r2, 0), P = def(o.eventRate, 1);
    return pnorm(Math.sqrt(o.n * P * (1 - r2)) * s * B - zAlpha(o));
  }

  // ---------- Logistic regression: Hsieh, Bloch and Larsen (1998), PASS ch. 860 ----------
  // Continuous (normal) X, odds ratio per one SD of X, P0 = Pr(Y=1) at the mean of X:
  //   N = (z_{1-a/2} + z_{1-b})^2 / [P0 (1 - P0) B^2],  B = ln(OR)
  // Binary X, R = share of the sample with X = 1, Pbar = (1-R) P0 + R P1:
  //   N = [z_{1-a/2} sqrt(Pbar(1-Pbar)/R) + z_{1-b} sqrt(P0(1-P0) + P1(1-P1)(1-R)/R)]^2
  //       / [(P0 - P1)^2 (1 - R)]
  // Other covariates: N_m = N / (1 - R2).
  // o: { p0, or | p1, r2, alpha, sides, power }  (+ fracX1 for binary X)
  function logitB(o) {
    if (o.or !== undefined) return Math.log(o.or);
    return Math.log((o.p1 / (1 - o.p1)) / (o.p0 / (1 - o.p0)));
  }

  function logisticNormalN(o) {
    var B = logitB(o), z = zAlpha(o) + zBeta(o);
    var raw = z * z / (o.p0 * (1 - o.p0) * B * B) / (1 - def(o.r2, 0));
    return { raw: raw, n: up(raw) };
  }

  function logisticNormalPower(o) {
    var B = Math.abs(logitB(o));
    var nEff = o.n * (1 - def(o.r2, 0));
    return pnorm(Math.sqrt(nEff * o.p0 * (1 - o.p0)) * B - zAlpha(o));
  }

  // Smallest odds ratio above 1 that N subjects can detect (normal X).
  function logisticNormalOR(o) {
    var nEff = o.n * (1 - def(o.r2, 0));
    return Math.exp((zAlpha(o) + zBeta(o)) / Math.sqrt(nEff * o.p0 * (1 - o.p0)));
  }

  function binaryParts(o) {
    var p0 = o.p0, p1 = o.p1 !== undefined ? o.p1 : oddsToP1(p0, o.or);
    var R = def(o.fracX1, 0.5);
    var pbar = (1 - R) * p0 + R * p1;
    return {
      p1: p1, R: R,
      s0: Math.sqrt(pbar * (1 - pbar) / R),
      s1: Math.sqrt(p0 * (1 - p0) + p1 * (1 - p1) * (1 - R) / R),
      d2: (p0 - p1) * (p0 - p1) * (1 - R)
    };
  }

  function logisticBinaryN(o) {
    var k = binaryParts(o);
    var t = zAlpha(o) * k.s0 + zBeta(o) * k.s1;
    var raw = t * t / k.d2 / (1 - def(o.r2, 0));
    return { raw: raw, n: up(raw), p1: k.p1 };
  }

  function logisticBinaryPower(o) {
    var k = binaryParts(o);
    var nEff = o.n * (1 - def(o.r2, 0));
    return pnorm((Math.sqrt(nEff * k.d2) - zAlpha(o) * k.s0) / k.s1);
  }

  // ---------- One ROC curve vs a null AUC: PASS ch. 260 ----------
  // N+ = [z_a sqrt(V(AUC0)) + z_b sqrt(V(AUC1))]^2 / (AUC1 - AUC0)^2
  // power = Phi( (|AUC1 - AUC0| sqrt(N+) - z_a sqrt(V(AUC0))) / sqrt(V(AUC1)) )
  // with R = N- / N+.
  //
  // Continuous data (Hanley and McNeil form, as PASS prints it):
  //   V(t) = t / [R (2 - t)] + 2 t^2 / (1 + t) - t^2 (1 + R) / R
  function rocVarContinuous(t, R) {
    return t / (R * (2 - t)) + 2 * t * t / (1 + t) - t * t * (1 + R) / R;
  }

  // Discrete rating data (Obuchowski and McClish 1997, binormal model):
  //   V(t) = f^2 (1 + B^2/R + A^2/2) + g^2 B^2 (1 + R) / (2R)
  //   A = qnorm(t) sqrt(1 + B^2), B = SD- / SD+
  function rocVarDiscrete(t, R, B) {
    B = def(B, 1);
    var A = qnorm(t) * Math.sqrt(1 + B * B);
    var E = Math.exp(-A * A / (2 + 2 * B * B));
    var f = E / Math.sqrt(2 * Math.PI * (1 + B * B));
    var g = -A * B * E / Math.sqrt(2 * Math.PI * Math.pow(1 + B * B, 3));
    return f * f * (1 + B * B / R + A * A / 2) + g * g * B * B * (1 + R) / (2 * R);
  }

  function rocV(t, o) {
    var R = def(o.ratio, 1);
    return o.data === 'discrete' ? rocVarDiscrete(t, R, o.b) : rocVarContinuous(t, R);
  }

  // o: { auc0, auc1, ratio, alpha, sides, power, data: 'continuous' | 'discrete', b }
  function rocN(o) {
    var auc0 = def(o.auc0, 0.5), R = def(o.ratio, 1);
    var t = zAlpha(o) * Math.sqrt(rocV(auc0, o)) + zBeta(o) * Math.sqrt(rocV(o.auc1, o));
    var raw = t * t / ((o.auc1 - auc0) * (o.auc1 - auc0));
    var nPos = up(raw), nNeg = up(nPos * R);
    return { raw: raw, nPos: nPos, nNeg: nNeg, n: nPos + nNeg, rawTotal: raw * (1 + R) };
  }

  // o: as rocN, with nPos in place of power.
  function rocPower(o) {
    var auc0 = def(o.auc0, 0.5);
    return pnorm((Math.abs(o.auc1 - auc0) * Math.sqrt(o.nPos) - zAlpha(o) * Math.sqrt(rocV(auc0, o))) /
                 Math.sqrt(rocV(o.auc1, o)));
  }

  var api = {
    pnorm: pnorm, qnorm: qnorm, dnorm: dnorm, oddsToP1: oddsToP1,
    coxEvents: coxEvents, coxN: coxN, coxPower: coxPower,
    logisticNormalN: logisticNormalN, logisticNormalPower: logisticNormalPower,
    logisticNormalOR: logisticNormalOR,
    logisticBinaryN: logisticBinaryN, logisticBinaryPower: logisticBinaryPower,
    rocVarContinuous: rocVarContinuous, rocVarDiscrete: rocVarDiscrete,
    rocN: rocN, rocPower: rocPower
  };

  root.LabPower = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
