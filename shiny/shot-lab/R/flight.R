# Ball flight: gravity plus air drag, in feet and seconds.
# Court coordinates match the Playground: x 0 to 20 ft across, y 0 to 44 ft
# along the court, net at y = 22. z is height above the court.

G      <- 32.174    # gravity, ft/s^2
DRAG   <- 0.0119    # drag per foot for a pickleball (26.5 g, 74 mm, Cd about 0.4)
NET_Y  <- 22
COURT_W <- 20
COURT_L <- 44
KITCHEN <- 7        # ft from the net to the kitchen line

# The net is 34 in. at the center and 36 in. at the sidelines.
net_height <- function(x) (34 + 2 * pmin(abs(x - 10), 10) / 10) / 12

# Fly one ball. `heading` is the direction along the court surface (radians),
# `angle` is the launch angle above level (degrees), `speed` is ft/s.
# `probe_y` asks for the ball's x and height as it crosses that line, which is
# where a player standing at the kitchen line would volley it.
fly <- function(x0, y0, z0, heading, speed, angle, probe_y = NA, dt = 0.005) {
  a  <- angle * pi / 180
  vx <- speed * cos(a) * cos(heading)
  vy <- speed * cos(a) * sin(heading)
  vz <- speed * sin(a)
  x <- x0; y <- y0; z <- z0
  peak <- z0; net_z <- NA; net_x <- NA; probe_x <- NA; probe_z <- NA
  hit_net <- FALSE
  for (i in seq_len(4000)) {
    v  <- sqrt(vx^2 + vy^2 + vz^2)
    vx <- vx - DRAG * v * vx * dt
    vy <- vy - DRAG * v * vy * dt
    vz <- vz - (G + DRAG * v * vz) * dt
    px <- x; py <- y; pz <- z
    x <- x + vx * dt; y <- y + vy * dt; z <- z + vz * dt
    if (z > peak) peak <- z
    if ((py - NET_Y) * (y - NET_Y) <= 0 && py != y && is.na(net_z)) {
      f <- (NET_Y - py) / (y - py)
      net_x <- px + f * (x - px); net_z <- pz + f * (z - pz)
      if (net_z < net_height(net_x)) { hit_net <- TRUE; x <- net_x; y <- NET_Y; break }
    }
    if (!is.na(probe_y) && is.na(probe_z) && (py - probe_y) * (y - probe_y) <= 0 && py != y) {
      f <- (probe_y - py) / (y - py)
      probe_x <- px + f * (x - px); probe_z <- pz + f * (z - pz)
    }
    if (z <= 0) {                      # landed: step back to the court surface
      f <- pz / (pz - z)
      x <- px + f * (x - px); y <- py + f * (y - py)
      break
    }
  }
  list(land_x = x, land_y = y, peak_z = peak, net_z = net_z, net_x = net_x,
       hit_net = hit_net, probe_x = probe_x, probe_z = probe_z)
}

# The speed that carries a ball `dist` feet at this launch angle (bisection).
solve_speed <- function(dist, angle, z0) {
  lo <- 3; hi <- 160
  for (i in 1:28) {
    mid <- (lo + hi) / 2
    f <- fly(0, -1000, z0, pi / 2, mid, angle, dt = 0.01)   # start far from the net
    if (f$land_y + 1000 < dist) lo <- mid else hi <- mid
  }
  (lo + hi) / 2
}

# Flight paths for many shots at once, for drawing. Returns one row per point:
# shot (row number in `d`), i (point number), x, y, z.
# Needs hit_x, hit_y, hit_z, land_x, land_y, speed, launch_angle, outcome.
shot_paths <- function(d, keep = 28, dt = 0.01) {
  n <- nrow(d)
  if (n == 0) return(data.frame(shot = integer(), i = integer(), x = numeric(), y = numeric(), z = numeric()))
  h  <- atan2(d$land_y - d$hit_y, d$land_x - d$hit_x)
  a  <- d$launch_angle * pi / 180
  vx <- d$speed * cos(a) * cos(h); vy <- d$speed * cos(a) * sin(h); vz <- d$speed * sin(a)
  x <- d$hit_x; y <- d$hit_y; z <- d$hit_z
  steps <- 700
  X <- Y <- Z <- matrix(NA_real_, steps + 1, n)
  X[1, ] <- x; Y[1, ] <- y; Z[1, ] <- z
  alive <- rep(TRUE, n)
  stops_at_net <- d$outcome == "net"
  for (s in seq_len(steps)) {
    v  <- sqrt(vx^2 + vy^2 + vz^2)
    vx <- vx - DRAG * v * vx * dt
    vy <- vy - DRAG * v * vy * dt
    vz <- vz - (G + DRAG * v * vz) * dt
    py <- y
    x <- x + vx * dt; y <- y + vy * dt; z <- z + vz * dt
    crossed <- (py - NET_Y) * (y - NET_Y) <= 0 & py != y
    alive <- alive & z > 0 & !(stops_at_net & crossed)
    if (!any(alive)) break
    X[s + 1, alive] <- x[alive]; Y[s + 1, alive] <- y[alive]; Z[s + 1, alive] <- z[alive]
  }
  out <- vector("list", n)
  for (j in seq_len(n)) {
    last <- sum(!is.na(Z[, j]))
    idx  <- unique(round(seq(1, last, length.out = min(keep, last))))
    end_z <- if (stops_at_net[j]) max(Z[last, j], 0) else 0
    out[[j]] <- data.frame(shot = j, i = seq_len(length(idx) + 1),
                           x = c(X[idx, j], d$land_x[j]),
                           y = c(Y[idx, j], d$land_y[j]),
                           z = c(Z[idx, j], end_z))
  }
  do.call(rbind, out)
}
