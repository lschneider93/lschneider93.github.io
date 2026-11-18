# Synthetic pickleball match for the Shot Lab.
# Run from shiny/shot-lab:  Rscript data-raw/simulate.R
# Writes data/shots.csv, one row per shot, in the shape real match data can
# fill later. Nothing here comes from a real match.

source("R/flight.R")
set.seed(20261117)

N_RALLIES <- 150
TEAMS <- list(team1 = c("A", "B"), team2 = c("C", "D"))
DIR   <- c(team1 = 1, team2 = -1)             # team1 hits toward larger y

# Each player's habits, so shot selection has something to find.
THIRD_DRIVE <- c(A = 0.35, B = 0.60, C = 0.45, D = 0.25)   # chance the third shot is a drive
SPEEDUP     <- c(A = 0.10, B = 0.20, C = 0.14, D = 0.08)   # chance to speed up a dink

# Per shot type: launch angle range (degrees) and how deep past the net it is aimed (ft).
SPEC <- list(
  serve    = list(angle = c(10, 16),  depth = c(13, 21)),
  return   = list(angle = c(14, 22),  depth = c(14, 21)),
  drive    = list(angle = c(4, 9),    depth = c(12, 20)),
  drop     = list(angle = c(22, 34),  depth = c(1.5, 6.5)),
  reset    = list(angle = c(20, 32),  depth = c(1.5, 6.5)),
  dink     = list(angle = c(22, 38),  depth = c(1.5, 6.5)),
  volley   = list(angle = c(-2, 8),   depth = c(7, 17)),
  speedup  = list(angle = c(2, 8),    depth = c(9, 15)),
  lob      = list(angle = c(40, 52),  depth = c(17, 21.5)),
  overhead = list(angle = c(-12, -4), depth = c(10, 19))
)
# Chance the other team cannot get a good shot back.
PUTAWAY <- c(serve = 0.01, return = 0.01, drive = 0.05, drop = 0.01, reset = 0.01, dink = 0.01,
             volley = 0.12, speedup = 0.18, lob = 0.03, overhead = 0.55)
SOFT <- c("drop", "reset", "dink")

other <- function(team) if (team == "team1") "team2" else "team1"
pick  <- function(p) sample(names(p), 1, prob = p)

# Hit one shot: aim, add human error, fly it, and judge it.
hit <- function(type, hx, hy, hz, dir, target_x = NULL) {
  sp    <- SPEC[[type]]
  angle <- runif(1, sp$angle[1], sp$angle[2])
  depth <- runif(1, sp$depth[1], sp$depth[2])
  tx <- if (is.null(target_x)) runif(1, 2.5, 17.5) else target_x
  ty <- NET_Y + dir * depth
  dist  <- sqrt((tx - hx)^2 + (ty - hy)^2)
  speed <- min(solve_speed(dist, angle, hz), 95)        # nobody hits harder than about 65 mph
  err   <- if (type == "serve") c(0.02, 1.5, 1.0) else c(0.035, 2.4, 1.6)
  speed <- speed * rnorm(1, 1, err[1])
  head  <- atan2(ty - hy, tx - hx) + rnorm(1, 0, err[2]) * pi / 180
  angle <- angle + rnorm(1, 0, err[3])
  f <- fly(hx, hy, hz, head, speed, angle, probe_y = NET_Y + dir * (KITCHEN + 0.5))
  inside <- f$land_x >= 0 && f$land_x <= COURT_W && f$land_y >= 0 && f$land_y <= COURT_L &&
            (f$land_y - NET_Y) * dir > 0
  short_serve <- type == "serve" && abs(f$land_y - NET_Y) < KITCHEN
  outcome <- if (f$hit_net) "net" else if (!inside || short_serve) "out"
             else if (runif(1) < PUTAWAY[[type]]) "winner" else "in"
  c(f, list(type = type, speed = speed, angle = angle, outcome = outcome,
            hit_x = hx, hit_y = hy, hit_z = hz))
}

rows <- list()
for (r in seq_len(N_RALLIES)) {
  serving <- if (r %% 2 == 1) "team1" else "team2"
  server  <- TEAMS[[serving]][((r - 1) %/% 2) %% 2 + 1]
  at_net  <- c(team1 = FALSE, team2 = FALSE)
  team <- serving; player <- server; dir <- DIR[[team]]
  # Serve from behind the baseline, into the box diagonally across.
  right_side <- (r %/% 4) %% 2 == 0
  sx <- if (xor(right_side, dir < 0)) runif(1, 11, 17) else runif(1, 3, 9)
  s  <- hit("serve", sx, NET_Y - dir * 22.5, 2.3, dir,
            target_x = if (sx > 10) runif(1, 2, 8.5) else runif(1, 11.5, 18))
  n <- 1; type <- "serve"
  repeat {
    rows[[length(rows) + 1]] <- data.frame(
      rally = r, shot_n = n, player = player, team = team, shot_type = s$type,
      hit_x = s$hit_x, hit_y = s$hit_y, hit_z = s$hit_z, speed = s$speed, launch_angle = s$angle,
      land_x = s$land_x, land_y = s$land_y, peak_z = s$peak_z,
      net_clearance = if (is.na(s$net_z)) NA else s$net_z - net_height(s$net_x),
      outcome = s$outcome)
    if (s$outcome != "in" || n >= 40) break

    # A soft ball that lands in the kitchen lets the hitting team come to the net.
    if (s$type %in% SOFT && abs(s$land_y - NET_Y) < KITCHEN && runif(1) < 0.65) at_net[[team]] <- TRUE
    if (s$type == "return") at_net[[team]] <- TRUE

    # The other team hits next.
    prev <- s; team <- other(team); dir <- DIR[[team]]
    player <- sample(TEAMS[[team]], 1); n <- n + 1
    can_volley <- at_net[[team]] && !is.na(prev$probe_z) && prev$probe_z > 0.8 && prev$probe_z < 8

    if (n == 2) {
      type <- "return"
    } else if (n == 3) {
      type <- if (runif(1) < THIRD_DRIVE[[player]]) "drive" else "drop"
    } else if (prev$type == "lob" && at_net[[team]]) {
      if (abs(prev$land_y - NET_Y) < 19 && runif(1) < 0.8) type <- "overhead"
      else { at_net[[team]] <- FALSE; can_volley <- FALSE; type <- pick(c(reset = 0.5, lob = 0.2, drive = 0.3)) }
    } else if (at_net[[team]] && prev$type %in% SOFT) {
      can_volley <- FALSE                                   # soft balls bounce in the kitchen
      su <- SPEEDUP[[player]]
      type <- if (at_net[[other(team)]]) pick(c(dink = 0.94 - su, speedup = su, lob = 0.06))
              else pick(c(dink = 0.45, drive = 0.55))
    } else if (can_volley) {
      type <- "volley"
    } else {
      type <- pick(c(reset = 0.55, drive = 0.35, lob = 0.10))
    }

    if (type == "overhead") {
      hx <- prev$land_x; hy <- NET_Y - dir * runif(1, 9, 15); hz <- runif(1, 6.8, 7.8)
    } else if (type == "volley") {
      hx <- prev$probe_x; hy <- NET_Y - dir * (KITCHEN + 0.5); hz <- min(max(prev$probe_z, 1.2), 7.5)
    } else {                                                # after the bounce
      back <- runif(1, 1.5, 3)
      hx <- prev$land_x; hy <- prev$land_y - dir * back
      hz <- if (type == "dink") runif(1, 1.0, 1.6) else runif(1, 1.8, 2.8)
    }
    hx <- min(max(hx, -1), 21)
    s <- hit(type, hx, hy, hz, dir)
  }
}
shots <- do.call(rbind, rows)

# Who won each rally, and did the hitter's team win it?
last <- shots[!duplicated(shots$rally, fromLast = TRUE), c("rally", "team", "outcome")]
last$winner <- ifelse(last$outcome == "winner", last$team,
               ifelse(last$outcome == "in", sample(c("team1", "team2"), nrow(last), replace = TRUE),
                      ifelse(last$team == "team1", "team2", "team1")))
shots$rally_won <- as.integer(shots$team == last$winner[match(shots$rally, last$rally)])

num <- sapply(shots, is.numeric)
shots[num] <- lapply(shots[num], round, 2)
dir.create("data", showWarnings = FALSE)
write.csv(shots, "data/shots.csv", row.names = FALSE)

cat(nrow(shots), "shots in", N_RALLIES, "rallies\n")
print(round(prop.table(table(shots$shot_type)), 3))
print(table(shots$outcome))
