# Shot Lab: what shot would you hit from here?
# Pick where on the court a shot was hit from, then see what players chose,
# how the ball flew, and how the rally turned out.
# The data is synthetic (data-raw/simulate.R). A real match export with the
# same columns can replace data/shots.csv.
# Files in R/ (flight.R, court.R) are loaded by Shiny automatically.

library(shiny)
library(bslib)
library(ggplot2)
library(plotly)

shots <- read.csv("data/shots.csv", stringsAsFactors = FALSE)
shots$zone   <- zone_of(shots$hit_y)
shots$family <- factor(FAMILY[shots$shot_type], levels = names(FAMILY_COL))
shots$id     <- seq_len(nrow(shots))

MAX_DRAWN <- 250      # arcs drawn at once; the numbers always use every shot
MIN_N     <- 8        # fewest shots before a percentage is shown

QUESTIONS <- list(
  q_third = list(label = "Third shot: drive or drop?", shot_n = "3",   types = c("drive", "drop"), zone = "all"),
  q_net   = list(label = "How high over the net?",     shot_n = "all", types = c("drive", "drop", "dink"), zone = "all"),
  q_dink  = list(label = "Where do dinks go?",         shot_n = "all", types = "dink", zone = "kitchen"),
  q_lob   = list(label = "Does the lob work?",         shot_n = "all", types = "lob",  zone = "all")
)

ui <- page_sidebar(
  title = "Shot Lab",
  theme = bs_theme(version = 5, bg = BG, fg = INK, primary = "#6EE7B7", secondary = SURFACE,
                   "card-bg" = SURFACE, "border-color" = GRID),
  fillable = FALSE,
  sidebar = sidebar(
    width = 300,
    p(class = "fw-bold mb-1", "Start with a question"),
    lapply(names(QUESTIONS), function(id) actionButton(id, QUESTIONS[[id]]$label, class = "btn-outline-primary btn-sm w-100 mb-1")),
    hr(),
    p(class = "fw-bold mb-1", "Or set your own"),
    selectInput("zone", "Hit from", c("Anywhere" = "all", ZONES)),
    selectInput("shot_n", "Shot in the rally", c("Any" = "all", "Serve (1st)" = "1", "Return (2nd)" = "2", "Third shot" = "3", "Fourth or later" = "4+")),
    checkboxGroupInput("types", "Shot type", choices = setNames(names(TYPE_LABEL), TYPE_LABEL), selected = names(TYPE_LABEL)),
    selectInput("player", "Player", c("All four" = "all", setNames(LETTERS[1:4], paste("Player", LETTERS[1:4])))),
    hr(),
    p(class = "fw-bold mb-1", "Or replay one rally"),
    selectInput("rally", NULL, c("All rallies" = "all", setNames(unique(shots$rally), paste("Rally", unique(shots$rally))))),
    conditionalPanel("input.rally != 'all'", sliderInput("upto", "Shots shown", min = 1, max = 2, value = 1, step = 1, animate = animationOptions(interval = 900)))
  ),
  h1(class = "h3 mt-2", "What shot would you hit from here?"),
  p("Pick a spot on the court. See what players chose from there, how the ball flew, and how it turned out. ",
    tags$span(class = "badge text-bg-warning", "Synthetic data"), " Real match data will replace it."),
  layout_columns(
    col_widths = c(5, 7),
    card(card_header("From above. Click the court to pick where shots were hit from."),
         plotOutput("top", height = 520, click = "top_click")),
    card(card_header("From the side. How high each ball cleared the net."),
         plotOutput("side", height = 300),
         card_header("Turn it. Drag to rotate, or use a preset."),
         div(actionButton("cam_top", "Top", class = "btn-sm"), actionButton("cam_side", "Side", class = "btn-sm"),
             actionButton("cam_behind", "Behind", class = "btn-sm")),
         plotlyOutput("space", height = 420))
  ),
  card(card_header(textOutput("answer_head")),
       layout_columns(col_widths = c(6, 6), uiOutput("answer"), plotOutput("choices", height = 300)))
)

server <- function(input, output, session) {

  # A question button sets the filters for you.
  lapply(names(QUESTIONS), function(id) observeEvent(input[[id]], {
    q <- QUESTIONS[[id]]
    updateSelectInput(session, "rally", selected = "all")
    updateSelectInput(session, "zone", selected = q$zone)
    updateSelectInput(session, "shot_n", selected = q$shot_n)
    updateSelectInput(session, "player", selected = "all")
    updateCheckboxGroupInput(session, "types", selected = q$types)
  }))

  # A click on the court picks the zone the click falls in (hitter's half only).
  observeEvent(input$top_click, {
    y <- input$top_click$y
    if (is.null(y) || y > NET_Y || input$rally != "all") return()
    updateSelectInput(session, "zone", selected = zone_of(y))
  })

  observeEvent(input$rally, {
    if (input$rally == "all") return()
    n <- sum(shots$rally == as.integer(input$rally))
    updateSliderInput(session, "upto", max = n, value = 1)
  })

  replay <- reactive(input$rally != "all")

  # The shots in play: one rally up to the chosen shot, or everything that matches the filters.
  picked <- reactive({
    if (replay()) {
      d <- shots[shots$rally == as.integer(input$rally) & shots$shot_n <= input$upto, ]
      return(d)
    }
    d <- shots[shots$shot_type %in% input$types, ]
    if (input$zone != "all")   d <- d[d$zone == input$zone, ]
    if (input$player != "all") d <- d[d$player == input$player, ]
    if (input$shot_n == "4+")  d <- d[d$shot_n >= 4, ]
    else if (input$shot_n != "all") d <- d[d$shot_n == as.integer(input$shot_n), ]
    face_up(d)                 # every hitter at the bottom, hitting up the page
  })

  # Flight paths for the shots that get drawn.
  drawn <- reactive({
    d <- picked()
    if (nrow(d) > MAX_DRAWN) d <- d[sort(sample(nrow(d), MAX_DRAWN)), ]
    p <- shot_paths(d)
    p$family <- d$family[p$shot]; p$id <- d$id[p$shot]; p$latest <- d$shot_n[p$shot] == max(d$shot_n, 0)
    list(shots = d, paths = p)
  })

  alpha <- function(n) if (n > 120) 0.35 else if (n > 30) 0.55 else 0.9

  output$top <- renderPlot({
    g <- drawn(); d <- g$shots
    p <- ggplot() + court_top()
    if (nrow(d) == 0) return(p + annotate("text", x = 10, y = 11, label = "No shots match", colour = INK))
    if (!replay() && input$zone != "all") {
      band <- switch(input$zone, kitchen = c(12, 22), mid = c(5, 12), base = c(-3, 5))
      p <- p + annotate("rect", xmin = -1, xmax = COURT_W + 1, ymin = band[1], ymax = band[2], fill = NA, colour = "#6EE7B7", linetype = "dashed", linewidth = 0.7)
    }
    p + geom_segment(data = d, aes(hit_x, hit_y, xend = land_x, yend = land_y, colour = family), alpha = alpha(nrow(d)), linewidth = 0.6) +
      geom_point(data = d, aes(land_x, land_y, colour = family, shape = outcome %in% c("net", "out")), size = 2.2, alpha = 0.9) +
      scale_colour_manual(values = FAMILY_COL, drop = TRUE) +
      scale_shape_manual(values = c(`FALSE` = 16, `TRUE` = 4), labels = c(`FALSE` = "Landed in", `TRUE` = "Net or out"), drop = FALSE)
  }, bg = SURFACE)

  output$side <- renderPlot({
    g <- drawn(); pa <- g$paths
    zmax <- max(8, ceiling(max(pa$z, 0) + 1))
    p <- ggplot() + court_side(zmax)
    if (nrow(pa) == 0) return(p)
    p + geom_path(data = pa, aes(y, z, group = id, colour = family), alpha = alpha(nrow(g$shots)), linewidth = 0.6) +
      scale_colour_manual(values = FAMILY_COL, drop = TRUE)
  }, bg = SURFACE)

  # 3D court. One trace per shot family, with gaps between shots.
  output$space <- renderPlotly({
    g <- drawn(); pa <- g$paths
    cl <- court_lines_3d()
    net <- data.frame(x = c(0, 0, 10, 20, 20, 0), y = NET_Y, z = c(0, 3, 34 / 12, 3, 0, 0))
    fig <- plot_ly() |>
      add_trace(data = cl, x = ~x, y = ~y, z = ~z, type = "scatter3d", mode = "lines",
                line = list(color = INK_DIM, width = 3), hoverinfo = "skip", showlegend = FALSE) |>
      add_trace(data = net, x = ~x, y = ~y, z = ~z, type = "scatter3d", mode = "lines",
                line = list(color = INK_BRIGHT, width = 5), hoverinfo = "skip", showlegend = FALSE)
    for (f in intersect(names(FAMILY_COL), as.character(unique(pa$family)))) {
      one <- pa[pa$family == f, ]
      gap <- do.call(rbind, lapply(split(one, one$id), function(s) rbind(s[, c("x", "y", "z")], data.frame(x = NA, y = NA, z = NA))))
      fig <- fig |> add_trace(data = gap, x = ~x, y = ~y, z = ~z, type = "scatter3d", mode = "lines", name = f,
                              line = list(color = FAMILY_COL[[f]], width = 3), opacity = alpha(nrow(g$shots)), hoverinfo = "name")
    }
    axis <- function(title, range) list(title = title, range = range, color = INK_DIM, gridcolor = GRID, backgroundcolor = SURFACE, showbackground = TRUE, zeroline = FALSE)
    fig |> layout(paper_bgcolor = SURFACE, font = list(color = INK), margin = list(l = 0, r = 0, t = 0, b = 0),
                  legend = list(orientation = "h"),
                  scene = list(aspectmode = "data", xaxis = axis("", c(-2, 22)), yaxis = axis("", c(-3, 47)),
                               zaxis = axis("ft", c(0, max(10, ceiling(max(pa$z, 0))))),
                               camera = list(eye = list(x = 1.9, y = -0.6, z = 0.7)))) |>
      config(displayModeBar = FALSE)
  })
  camera <- function(x, y, z) plotlyProxy("space", session) |> plotlyProxyInvoke("relayout", list(scene.camera = list(eye = list(x = x, y = y, z = z))))
  observeEvent(input$cam_top,    camera(0.001, -0.01, 2.4))
  observeEvent(input$cam_side,   camera(2.3, 0, 0.15))
  observeEvent(input$cam_behind, camera(0, -2.3, 0.5))

  # What players chose, and how it went, counted from every matching shot.
  summary_tbl <- reactive({
    d <- picked()
    if (nrow(d) == 0) return(NULL)
    t <- do.call(rbind, lapply(split(d, d$shot_type), function(s) data.frame(
      type = s$shot_type[1], n = nrow(s), won = mean(s$rally_won),
      clear = mean(s$net_clearance, na.rm = TRUE), fault = mean(s$outcome %in% c("net", "out")))))
    t$share <- t$n / sum(t$n)
    t[order(-t$n), ]
  })

  output$answer_head <- renderText({
    if (replay()) return(paste("Rally", input$rally, "so far"))
    where <- if (input$zone == "all") "From anywhere on the court" else paste("From the", tolower(names(ZONES)[ZONES == input$zone]))
    paste0(where, ": ", nrow(picked()), " shots")
  })

  output$answer <- renderUI({
    t <- summary_tbl()
    if (is.null(t)) return(p("No shots match. Widen the filters."))
    pct <- function(x) paste0(round(100 * x), "%")
    if (replay()) {
      d <- picked(); s <- d[nrow(d), ]
      end <- switch(s$outcome, net = "It hit the net.", out = "It landed out.", winner = "Nobody got it back.", `in` = "It landed in.")
      return(tagList(p(class = "fs-5", sprintf("Shot %d: Player %s hit a %s at %d mph.", s$shot_n, s$player, tolower(TYPE_LABEL[[s$shot_type]]), round(s$speed * 0.6818))),
                     p(end, if (!is.na(s$net_clearance) && s$outcome != "net") sprintf(" It cleared the net by %.1f ft and peaked at %.1f ft.", s$net_clearance, s$peak_z))))
    }
    big <- t[t$n >= MIN_N, ]
    lines <- list(p(class = "fs-5", paste0("Players chose ", paste(sprintf("a %s %s of the time", tolower(TYPE_LABEL[head(t$type, 3)]), pct(head(t$share, 3))), collapse = ", "), ".")))
    if (nrow(big) > 0) {
      lines <- c(lines, lapply(seq_len(min(nrow(big), 4)), function(i) with(big[i, ], p(sprintf(
        "%s (%d shots): cleared the net by %.1f ft on average, missed %s, and the hitting team won the rally %s.",
        TYPE_LABEL[[type]], n, clear, pct(fault), pct(won))))))
    } else lines <- c(lines, list(p(class = "text-secondary", sprintf("Fewer than %d shots of each type, so no percentages yet.", MIN_N))))
    tagList(lines)
  })

  output$choices <- renderPlot({
    t <- summary_tbl()
    if (is.null(t)) return(NULL)
    t$label <- factor(TYPE_LABEL[t$type], levels = rev(TYPE_LABEL[t$type]))
    t$family <- factor(FAMILY[t$type], levels = names(FAMILY_COL))
    t$note <- ifelse(t$n >= MIN_N, sprintf("%d%%  ·  won %d%%", round(100 * t$share), round(100 * t$won)), sprintf("%d shots", t$n))
    ggplot(t, aes(share, label, fill = family)) +
      geom_col(width = 0.55) +
      geom_text(aes(label = note), hjust = -0.08, colour = INK, size = 4.6) +
      scale_fill_manual(values = FAMILY_COL, drop = TRUE) +
      scale_x_continuous(labels = function(x) paste0(round(100 * x), "%"), limits = c(0, max(t$share) * 1.55), expand = c(0, 0)) +
      labs(x = "Share of shots chosen", y = NULL) + theme_lab() +
      theme(panel.grid.major.y = element_blank(), legend.position = "none")
  }, bg = SURFACE)
}

shinyApp(ui, server)
