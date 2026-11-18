# Court drawings and shared look for the Shot Lab.
# Colors are the portfolio site's dark theme tokens (css/main.css).

library(ggplot2)

INK    <- "#D5DEEA"; INK_DIM <- "#9DABBF"; INK_BRIGHT <- "#F1F5F9"
BG     <- "#0B1220"; SURFACE <- "#131C2E"; GRID <- "#26324A"
COURT_FILL <- "#1B2740"; KITCHEN_FILL <- "#22463F"

# Ten shot types are too many colors to tell apart, so shots are colored by
# what kind of ball they are. Colors are the site's checked chart series.
FAMILY <- c(serve = "Serve or return", return = "Serve or return",
            drive = "Hard", speedup = "Hard", overhead = "Hard", volley = "Hard",
            drop = "Soft", reset = "Soft", dink = "Soft", lob = "Lob")
FAMILY_COL <- c("Soft" = "#1FA876", "Hard" = "#3B9BEA", "Lob" = "#C4831E", "Serve or return" = "#9478DC")
TYPE_LABEL <- c(serve = "Serve", return = "Return", drive = "Drive", drop = "Drop", reset = "Reset",
                dink = "Dink", volley = "Volley", speedup = "Speed-up", lob = "Lob", overhead = "Overhead")
ZONES <- c("Kitchen line" = "kitchen", "Mid-court" = "mid", "Baseline" = "base")

# Where the hitter stood, measured from the net.
zone_of <- function(hit_y) {
  d <- abs(hit_y - NET_Y)
  ifelse(d < 10, "kitchen", ifelse(d < 17, "mid", "base"))
}

# Turn every shot so the hitter is at the bottom hitting up the page.
face_up <- function(d) {
  flip <- d$hit_y > NET_Y
  d$hit_x[flip]  <- COURT_W - d$hit_x[flip];  d$hit_y[flip]  <- COURT_L - d$hit_y[flip]
  d$land_x[flip] <- COURT_W - d$land_x[flip]; d$land_y[flip] <- COURT_L - d$land_y[flip]
  d
}

theme_lab <- function() {
  theme_minimal(base_size = 15) +
    theme(plot.background = element_rect(fill = SURFACE, colour = NA),
          panel.background = element_rect(fill = SURFACE, colour = NA),
          panel.grid.major = element_line(colour = GRID, linewidth = 0.3),
          panel.grid.minor = element_blank(),
          text = element_text(colour = INK), axis.text = element_text(colour = INK_DIM),
          axis.title = element_text(colour = INK_DIM),
          legend.position = "top", legend.title = element_blank(),
          legend.text = element_text(colour = INK),
          plot.margin = margin(8, 12, 8, 8))
}

# Top view: court, kitchen, lines, net.
court_top <- function() {
  list(
    annotate("rect", xmin = 0, xmax = COURT_W, ymin = 0, ymax = COURT_L, fill = COURT_FILL, colour = NA),
    annotate("rect", xmin = 0, xmax = COURT_W, ymin = NET_Y - KITCHEN, ymax = NET_Y + KITCHEN, fill = KITCHEN_FILL, colour = NA),
    annotate("rect", xmin = 0, xmax = COURT_W, ymin = 0, ymax = COURT_L, fill = NA, colour = INK_DIM, linewidth = 0.5),
    annotate("segment", x = 0, xend = COURT_W, y = c(NET_Y - KITCHEN, NET_Y + KITCHEN), yend = c(NET_Y - KITCHEN, NET_Y + KITCHEN), colour = INK_DIM, linewidth = 0.5),
    annotate("segment", x = 10, xend = 10, y = c(0, NET_Y + KITCHEN), yend = c(NET_Y - KITCHEN, COURT_L), colour = INK_DIM, linewidth = 0.5),
    annotate("segment", x = -0.5, xend = COURT_W + 0.5, y = NET_Y, yend = NET_Y, colour = INK_BRIGHT, linewidth = 1.3),
    annotate("text", x = COURT_W + 0.9, y = NET_Y, label = "net", colour = INK_DIM, angle = 90, size = 4),
    coord_fixed(xlim = c(-2, COURT_W + 2), ylim = c(-3, COURT_L + 3), expand = FALSE),
    theme_lab(),
    theme(axis.text = element_blank(), axis.title = element_blank(), panel.grid = element_blank())
  )
}

# Side view: the ground, the net at its real height, and feet along the court.
court_side <- function(zmax = 12) {
  list(
    annotate("rect", xmin = NET_Y - KITCHEN, xmax = NET_Y + KITCHEN, ymin = -0.25, ymax = 0, fill = KITCHEN_FILL, colour = NA),
    annotate("segment", x = 0, xend = COURT_L, y = 0, yend = 0, colour = INK_DIM, linewidth = 0.6),
    annotate("segment", x = NET_Y, xend = NET_Y, y = 0, yend = 34 / 12, colour = INK_BRIGHT, linewidth = 1.3),
    annotate("text", x = NET_Y, y = 34 / 12 + 0.45, label = "net, 34 in.", colour = INK_DIM, size = 4),
    scale_x_continuous("Feet along the court", breaks = c(0, 15, 22, 29, 44),
                       labels = c("baseline", "kitchen", "net", "kitchen", "baseline")),
    scale_y_continuous("Height (ft)", breaks = seq(0, 30, 2)),
    coord_cartesian(xlim = c(-3, COURT_L + 3), ylim = c(-0.25, zmax), expand = FALSE),
    theme_lab()
  )
}

# Court lines for the 3D view, as one path with gaps (NA) between pieces.
court_lines_3d <- function() {
  seg <- function(x1, y1, x2, y2) data.frame(x = c(x1, x2, NA), y = c(y1, y2, NA), z = c(0, 0, NA))
  rbind(seg(0, 0, COURT_W, 0), seg(COURT_W, 0, COURT_W, COURT_L), seg(COURT_W, COURT_L, 0, COURT_L), seg(0, COURT_L, 0, 0),
        seg(0, NET_Y - KITCHEN, COURT_W, NET_Y - KITCHEN), seg(0, NET_Y + KITCHEN, COURT_W, NET_Y + KITCHEN),
        seg(10, 0, 10, NET_Y - KITCHEN), seg(10, NET_Y + KITCHEN, 10, COURT_L))
}
