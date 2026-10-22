#!/usr/bin/env python3
"""Citi Bike NYC trip-data prep.

Downloads monthly trip zips from the public S3 bucket, converts them to typed
Parquet, applies documented cleaning rules, and writes small aggregate JSONs
that the static dashboard page renders. Raw staging lives under
data/citibike/raw/ (gitignored); only the JSONs in data/citibike/ are committed.

Usage:
  python3 scripts/citibike/prep.py                     # default months 2025-08:2026-07
  python3 scripts/citibike/prep.py --months 2026-06:2026-07
  python3 scripts/citibike/prep.py --keep-zips

Stages, each idempotent and auto-skipped when its output exists:
  1. download   zip -> raw/zips/YYYYMM-citibike-tripdata.zip
  2. convert    unzip, type with try_cast, write raw/parquet/YYYYMM.parquet,
                then delete the CSVs and (unless --keep-zips) the zip
  3. aggregate  one DuckDB pass over all parquet -> eight JSONs
"""
import argparse
import json
import shutil
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import duckdb
except ImportError:
    sys.exit("duckdb not installed. Run: pip3 install --user duckdb")

BASE = Path(__file__).resolve().parents[2]
OUT = BASE / "data" / "citibike"
RAW = OUT / "raw"
ZIPS = RAW / "zips"
PARQUET = RAW / "parquet"
TMP = RAW / "tmp"
S3 = "https://s3.amazonaws.com/tripdata"

# NYC metro bounding box, generous around all five boroughs.
LAT_MIN, LAT_MAX = 40.49, 41.00
LNG_MIN, LNG_MAX = -74.28, -73.65

# Cleaning rules. found counts may overlap between rules; `removed` is the
# deduplicated drop total so rows_in - removed == rows_out exactly.
CHECKS = [
    {"id": "bad_timestamp", "label": "Unparseable or missing timestamp", "threshold": "started_at or ended_at fails to parse", "disposition": "drop"},
    {"id": "nonpositive_duration", "label": "Non-positive duration", "threshold": "duration <= 0s (incl. DST fall-back artifacts; files are local NY time)", "disposition": "drop"},
    {"id": "sub_minute", "label": "Sub-minute trip", "threshold": "0s < duration < 60s (false start or immediate re-dock)", "disposition": "drop"},
    {"id": "over_24h", "label": "Over 24 hours", "threshold": "duration > 24h (Lyft caps at 1500 min, so these are caps not measurements)", "disposition": "drop"},
    {"id": "short_roundtrip", "label": "Short same-station round trip", "threshold": "same start and end station, duration < 120s (dock test)", "disposition": "drop"},
    {"id": "bad_coords", "label": "Out-of-bounds coordinates", "threshold": "start location missing, or lat outside [40.49, 41.00], or lng outside [-74.28, -73.65]", "disposition": "drop"},
    {"id": "missing_end", "label": "Missing end station or coords", "threshold": "end_station_id or end_lat is null (bike never docked)", "disposition": "keep and flag"},
    {"id": "duplicate_ride_id", "label": "Duplicate ride_id", "threshold": "ride_id appears more than once", "disposition": "counted, kept"},
    {"id": "out_of_window", "label": "Outside the 12-month window", "threshold": "trip started before the first requested month; files bucket trips by end time, so each file carries a few strays from the prior month", "disposition": "drop"},
]

# Single drop predicate; every branch is NULL-safe so it never evaluates to
# SQL NULL (which would silently drop keep-and-flag rows in WHERE NOT (...)).
IS_DROP = f"""(
    started_at IS NULL OR ended_at IS NULL
    OR dur_s < 60
    OR dur_s > 86400
    OR (coalesce(start_station_id = end_station_id, FALSE) AND dur_s < 120)
    OR start_lat IS NULL OR start_lng IS NULL
    OR start_lat NOT BETWEEN {LAT_MIN} AND {LAT_MAX}
    OR start_lng NOT BETWEEN {LNG_MIN} AND {LNG_MAX}
    OR (end_lat IS NOT NULL AND (end_lat NOT BETWEEN {LAT_MIN} AND {LAT_MAX}
                                 OR coalesce(end_lng NOT BETWEEN {LNG_MIN} AND {LNG_MAX}, TRUE)))
)"""

RAW_COLS = ["ride_id", "rideable_type", "started_at", "ended_at",
            "start_station_name", "start_station_id", "end_station_name", "end_station_id",
            "start_lat", "start_lng", "end_lat", "end_lng", "member_casual"]


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def month_list(spec):
    """'2025-08:2026-07' or '2025-08,2025-09' -> ['202508', ...]"""
    def parse(s):
        y, m = s.strip().split("-")
        return int(y), int(m)
    if ":" in spec:
        (y0, m0), (y1, m1) = parse(spec.split(":")[0]), parse(spec.split(":")[1])
        months, y, m = [], y0, m0
        while (y, m) <= (y1, m1):
            months.append(f"{y}{m:02d}")
            m += 1
            if m > 12:
                y, m = y + 1, 1
        return months
    return [f"{parse(s)[0]}{parse(s)[1]:02d}" for s in spec.split(",")]


def download(month):
    zip_path = ZIPS / f"{month}-citibike-tripdata.zip"
    if (PARQUET / f"{month}.parquet").exists():
        return None
    if zip_path.exists() and zip_path.stat().st_size > 0:
        log(f"{month}: zip already present")
        return zip_path
    url = f"{S3}/{month}-citibike-tripdata.zip"
    log(f"{month}: downloading {url}")
    tmp_path = zip_path.with_suffix(".part")
    last = [-1]

    def hook(blocks, bs, total):
        if total > 0:
            pct = blocks * bs * 100 // total
            if pct // 10 > last[0]:
                last[0] = pct // 10
                print(f"    {min(pct, 100)}% of {total // (1024*1024)} MB", flush=True)
    urllib.request.urlretrieve(url, tmp_path, reporthook=hook)
    tmp_path.rename(zip_path)
    return zip_path


def convert(month, keep_zips):
    pq_path = PARQUET / f"{month}.parquet"
    if pq_path.exists():
        log(f"{month}: parquet exists, skipping convert")
        return
    zip_path = ZIPS / f"{month}-citibike-tripdata.zip"
    tmp_dir = TMP / month
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as zf:
        members = [n for n in zf.namelist()
                   if n.lower().endswith(".csv")
                   and "__MACOSX" not in n
                   and not Path(n).name.startswith(".")]
        if not members:
            sys.exit(f"{month}: no CSV members found in zip")
        log(f"{month}: extracting {len(members)} CSV file(s)")
        for n in members:
            dest = tmp_dir / Path(n).name
            with zf.open(n) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out, 1 << 20)

    con = duckdb.connect()
    con.execute(f"SET temp_directory='{TMP}'")
    con.execute("SET preserve_insertion_order=false")
    con.execute("SET memory_limit='4GB'")
    log(f"{month}: converting to parquet")
    con.execute(f"""
        COPY (
            SELECT
                nullif(ride_id, '') AS ride_id,
                CASE nullif(rideable_type, '')
                    WHEN 'docked_bike' THEN 'classic_bike'
                    ELSE nullif(rideable_type, '') END AS rideable_type,
                try_cast(started_at AS TIMESTAMP) AS started_at,
                try_cast(ended_at AS TIMESTAMP) AS ended_at,
                nullif(start_station_name, '') AS start_station_name,
                nullif(start_station_id, '') AS start_station_id,
                nullif(end_station_name, '') AS end_station_name,
                nullif(end_station_id, '') AS end_station_id,
                try_cast(start_lat AS DOUBLE) AS start_lat,
                try_cast(start_lng AS DOUBLE) AS start_lng,
                try_cast(end_lat AS DOUBLE) AS end_lat,
                try_cast(end_lng AS DOUBLE) AS end_lng,
                nullif(member_casual, '') AS member_casual
            FROM read_csv('{tmp_dir}/*.csv', header=true, union_by_name=true, all_varchar=true)
        ) TO '{pq_path}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    rows = con.execute(f"SELECT count(*) FROM read_parquet('{pq_path}')").fetchone()[0]
    con.close()
    log(f"{month}: {rows:,} rows -> {pq_path.name} ({pq_path.stat().st_size // (1024*1024)} MB)")
    shutil.rmtree(tmp_dir)
    if not keep_zips:
        zip_path.unlink()
        log(f"{month}: zip deleted (staging cleanup)")


def rnd(x, nd):
    return None if x is None else round(x, nd)


def aggregate(months):
    con = duckdb.connect()
    con.execute(f"SET temp_directory='{TMP}'")
    con.execute("SET preserve_insertion_order=false")
    con.execute("SET memory_limit='4GB'")
    con.execute(f"""
        CREATE VIEW trips AS
        SELECT *,
               date_diff('second', started_at, ended_at) AS dur_s,
               strftime(started_at, '%Y-%m') AS month
        FROM read_parquet('{PARQUET}/*.parquet')
    """)
    win_months = [f"{m[:4]}-{m[4:]}" for m in months]
    wy, wm = int(months[-1][:4]), int(months[-1][4:]) + 1
    if wm > 12:
        wy, wm = wy + 1, 1
    win_start = f"{months[0][:4]}-{months[0][4:]}-01"
    win_end = f"{wy}-{wm:02d}-01"
    in_window = (f"(started_at >= TIMESTAMP '{win_start} 00:00:00' "
                 f"AND started_at < TIMESTAMP '{win_end} 00:00:00')")
    con.execute(f"CREATE VIEW trips_clean AS SELECT * FROM trips WHERE NOT {IS_DROP} AND {in_window}")

    log("aggregate: quality report")
    qrows = con.execute(f"""
        SELECT coalesce(month, 'unknown') AS m,
               count(*) AS rows_in,
               count(*) FILTER (started_at IS NULL OR ended_at IS NULL) AS bad_timestamp,
               count(*) FILTER (dur_s <= 0) AS nonpositive_duration,
               count(*) FILTER (dur_s > 0 AND dur_s < 60) AS sub_minute,
               count(*) FILTER (dur_s > 86400) AS over_24h,
               count(*) FILTER (coalesce(start_station_id = end_station_id, FALSE)
                                AND dur_s < 120) AS short_roundtrip,
               count(*) FILTER (start_lat IS NULL OR start_lng IS NULL
                                OR start_lat NOT BETWEEN {LAT_MIN} AND {LAT_MAX}
                                OR start_lng NOT BETWEEN {LNG_MIN} AND {LNG_MAX}
                                OR (end_lat IS NOT NULL AND (end_lat NOT BETWEEN {LAT_MIN} AND {LAT_MAX}
                                    OR coalesce(end_lng NOT BETWEEN {LNG_MIN} AND {LNG_MAX}, TRUE)))) AS bad_coords,
               count(*) FILTER (end_station_id IS NULL OR end_lat IS NULL) AS missing_end,
               count(*) - count(DISTINCT ride_id) AS duplicate_ride_id,
               count(*) FILTER {IS_DROP} AS removed,
               strftime(min(started_at), '%Y-%m-%d %H:%M:%S') AS ts_min,
               strftime(max(started_at), '%Y-%m-%d %H:%M:%S') AS ts_max
        FROM trips WHERE month IN ({', '.join(chr(39) + m + chr(39) for m in win_months)})
        GROUP BY 1 ORDER BY 1
    """).fetchall()
    found_ids = ["bad_timestamp", "nonpositive_duration", "sub_minute", "over_24h",
                 "short_roundtrip", "bad_coords"]
    q_months = []
    for r in qrows:
        d = dict(zip(["month", "rows_in"] + found_ids + ["missing_end", "duplicate_ride_id",
                     "removed", "ts_min", "ts_max"], r))
        q_months.append({
            "month": d["month"], "rows_in": d["rows_in"],
            "rows_removed": d["removed"], "rows_out": d["rows_in"] - d["removed"],
            "found": {k: d[k] for k in found_ids},
            "flagged": {"missing_end": d["missing_end"],
                        "duplicate_ride_id": d["duplicate_ride_id"]},
            "ts_min": d["ts_min"], "ts_max": d["ts_max"],
        })

    log("aggregate: null rates")
    null_sql = ", ".join(f"avg(({c} IS NULL)::INT) AS {c}" for c in RAW_COLS)
    nr = con.execute(f"SELECT {null_sql} FROM trips").fetchone()
    null_rates = {c: rnd(v, 5) for c, v in zip(RAW_COLS, nr)}

    dupes_total = sum(m["flagged"]["duplicate_ride_id"] for m in q_months)
    if dupes_total:
        log(f"WARNING: {dupes_total} duplicate ride_ids found; aggregates keep them (documented), consider dedupe")

    out_of_window = con.execute(f"SELECT count(*) FROM trips WHERE NOT {in_window}").fetchone()[0]
    quality = {"checks": CHECKS, "months": q_months, "out_of_window": out_of_window,
               "window": {"start": win_start, "end": win_end}, "null_rates": null_rates}

    log("aggregate: daily counts")
    daily_rows = con.execute("""
        SELECT started_at::DATE AS d, member_casual, rideable_type, count(*)
        FROM trips_clean GROUP BY ALL ORDER BY d
    """).fetchall()
    d_min, d_max = daily_rows[0][0], daily_rows[-1][0]
    dates = []
    cur = d_min
    while cur <= d_max:
        dates.append(cur.isoformat())
        cur += timedelta(days=1)
    idx = {ds: i for i, ds in enumerate(dates)}
    series_keys = ["member_classic_bike", "member_electric_bike",
                   "casual_classic_bike", "casual_electric_bike"]
    counts = {k: [0] * len(dates) for k in series_keys}
    for d, mc, rt, c in daily_rows:
        counts[f"{mc}_{rt}"][idx[d.isoformat()]] = c
    daily = {"dates": dates, "counts": counts}

    log("aggregate: hour x weekday heatmap")
    hm = {"member": [[0] * 24 for _ in range(7)], "casual": [[0] * 24 for _ in range(7)]}
    for dow, hr, mc, c in con.execute("""
        SELECT isodow(started_at), hour(started_at), member_casual, count(*)
        FROM trips_clean GROUP BY ALL
    """).fetchall():
        hm[mc][dow - 1][hr] = c
    hourly = {"hours": list(range(24)),
              "weekdays": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
              "member": hm["member"], "casual": hm["casual"]}

    log("aggregate: duration histogram")
    # buckets: 0-59 = 1-min bins, 60-71 = 5-min bins (60-120 min), 72 = >120 min
    edges = list(range(0, 61)) + list(range(65, 121, 5))
    n_bins = len(edges)  # 73 bins incl. overflow
    hist = {"member": [0] * n_bins, "casual": [0] * n_bins}
    for mc, b, c in con.execute("""
        SELECT member_casual,
               CASE WHEN dur_s < 3600 THEN floor(dur_s / 60.0)::INT
                    WHEN dur_s < 7200 THEN 60 + floor((dur_s - 3600) / 300.0)::INT
                    ELSE 72 END AS bucket,
               count(*)
        FROM trips_clean GROUP BY ALL
    """).fetchall():
        hist[mc][b] = c
    duration_hist = {"edges_min": edges, "note": "last bin is 120+ min",
                     "member": hist["member"], "casual": hist["casual"]}

    log("aggregate: monthly summary")
    monthly_rows = con.execute("""
        SELECT month, count(*) AS trips,
               round(median(dur_s) / 60.0, 1),
               round(quantile_cont(dur_s, 0.9) / 60.0, 1),
               round(avg((member_casual = 'member')::INT), 4),
               round(avg((rideable_type = 'electric_bike')::INT), 4)
        FROM trips_clean GROUP BY month ORDER BY month
    """).fetchall()
    monthly = {"months": [r[0] for r in monthly_rows],
               "trips": [r[1] for r in monthly_rows],
               "median_min": [r[2] for r in monthly_rows],
               "p90_min": [r[3] for r in monthly_rows],
               "pct_member": [r[4] for r in monthly_rows],
               "pct_electric": [r[5] for r in monthly_rows]}

    log("aggregate: top stations")
    dep_rows = con.execute("""
        SELECT start_station_id, any_value(start_station_name),
               round(any_value(start_lat), 5), round(any_value(start_lng), 5),
               count(*) AS departures,
               round(avg((member_casual = 'member')::INT), 4)
        FROM trips_clean WHERE start_station_id IS NOT NULL
        GROUP BY 1 ORDER BY departures DESC LIMIT 30
    """).fetchall()
    arr = dict(con.execute("""
        SELECT end_station_id, count(*) FROM trips_clean
        WHERE end_station_id IS NOT NULL GROUP BY 1
    """).fetchall())
    stations = {"stations": [
        {"id": r[0], "name": r[1], "lat": r[2], "lng": r[3],
         "departures": r[4], "arrivals": arr.get(r[0], 0), "pct_member": r[5]}
        for r in dep_rows]}

    log("aggregate: sample rows")
    sample_select = """
        SELECT ride_id, rideable_type,
               strftime(started_at, '%Y-%m-%d %H:%M:%S') AS started_at,
               strftime(ended_at, '%Y-%m-%d %H:%M:%S') AS ended_at,
               start_station_name, start_station_id, end_station_name, end_station_id,
               round(start_lat, 5), round(start_lng, 5), round(end_lat, 5), round(end_lng, 5),
               member_casual, round(dur_s / 60.0, 1) AS dur_min
    """
    kept = con.execute(
        sample_select + ", 'kept' AS status FROM (SELECT * FROM trips_clean) USING SAMPLE reservoir(150 ROWS)"
    ).fetchall()
    removed = con.execute(sample_select + f""",
               CASE WHEN started_at IS NULL OR ended_at IS NULL THEN 'bad_timestamp'
                    WHEN dur_s <= 0 THEN 'nonpositive_duration'
                    WHEN dur_s < 60 THEN 'sub_minute'
                    WHEN dur_s > 86400 THEN 'over_24h'
                    WHEN coalesce(start_station_id = end_station_id, FALSE)
                         AND dur_s < 120 THEN 'short_roundtrip'
                    ELSE 'bad_coords' END AS status
        FROM (SELECT * FROM trips WHERE {IS_DROP}) USING SAMPLE reservoir(50 ROWS)
    """).fetchall()
    sample = {"columns": ["ride_id", "rideable_type", "started_at", "ended_at",
                          "start_station_name", "start_station_id",
                          "end_station_name", "end_station_id",
                          "start_lat", "start_lng", "end_lat", "end_lng",
                          "member_casual", "dur_min", "status"],
              "rows": [list(r) for r in kept + removed]}

    totals = {"rows_in": sum(m["rows_in"] for m in q_months) + out_of_window,
              "rows_removed": sum(m["rows_removed"] for m in q_months) + out_of_window,
              "rows_out": sum(m["rows_out"] for m in q_months)}
    meta = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": f"{S3}/", "system": "Citi Bike NYC (excludes JC- Jersey City files)",
            "months_requested": [f"{m[:4]}-{m[4:]}" for m in months],
            "bbox": {"lat": [LAT_MIN, LAT_MAX], "lng": [LNG_MIN, LNG_MAX]},
            "totals": totals}

    con.close()

    for name, obj in [("meta", meta), ("quality", quality), ("daily", daily),
                      ("hourly_weekday", hourly), ("duration_hist", duration_hist),
                      ("monthly", monthly), ("stations", stations), ("sample", sample)]:
        path = OUT / f"{name}.json"
        with open(path, "w") as f:
            json.dump(obj, f, separators=(",", ":"))
        log(f"wrote {path.relative_to(BASE)} ({path.stat().st_size / 1024:.1f} KB)")
    log(f"totals: in {totals['rows_in']:,} removed {totals['rows_removed']:,} "
        f"({totals['rows_removed'] / max(totals['rows_in'], 1):.3%}) out {totals['rows_out']:,}")


def main():
    ap = argparse.ArgumentParser(description="Citi Bike trip-data prep pipeline")
    ap.add_argument("--months", default="2025-08:2026-07",
                    help="range 'YYYY-MM:YYYY-MM' or comma list (default 2025-08:2026-07)")
    ap.add_argument("--keep-zips", action="store_true",
                    help="keep downloaded zips after parquet conversion (needs ~8GB extra disk)")
    ap.add_argument("--aggregate-only", action="store_true",
                    help="skip download/convert, rebuild JSONs from existing parquet")
    args = ap.parse_args()
    months = month_list(args.months)
    for p in (ZIPS, PARQUET, TMP, OUT):
        p.mkdir(parents=True, exist_ok=True)
    if not args.aggregate_only:
        for m in months:
            download(m)
            convert(m, args.keep_zips)
    missing = [m for m in months if not (PARQUET / f"{m}.parquet").exists()]
    if missing:
        sys.exit(f"missing parquet for months: {missing}")
    aggregate(months)
    log("done")


if __name__ == "__main__":
    main()
