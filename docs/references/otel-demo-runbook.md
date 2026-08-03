# OpenTelemetry Demo capture runbook (TA-052)

Goal: a reproducible incident recording from the OTel Demo (Astronomy Shop),
converted by `python -m faultline_data.adapters.otel_demo`. Live capture is a
human step (Docker + ~20 min); the converter and metadata contract are done.

## Capture procedure

1. Pin the demo: `git clone https://github.com/open-telemetry/opentelemetry-demo && git checkout <commit>`.
   Record the commit and `docker compose images` output.
2. `docker compose up -d`; wait for steady state (~5 min); keep default Locust load
   (record its user count/spawn rate).
3. Induce a fault with a built-in feature flag (flagd UI at :8080/feature):
   e.g. `recommendationServiceCacheFailure` (mem growth) or
   `adServiceHighCpu` (cpu). Record flag name + on/off timestamps (unix sec).
4. Export signals for the window (steady state + fault + recovery):
   - metrics: query Prometheus (:9090) for per-service cpu/mem/latency/error
     series; save as `metrics.json` `{"{service}_{metric}": [[sec, value], ...]}`
   - traces: Jaeger (:16686) CSV export with columns
     `time,traceID,spanID,serviceName,methodName,operationName,startTimeMillis,startTime,duration,statusCode,parentSpanID`
   - logs: docker compose logs with timestamps -> `logs.csv`
     (`timestamp,container_name,message`)
5. Write `capture/scenario.json` with ALL 12 required fields (the converter
   rejects captures missing any):
   demo_git_commit, container_image_versions, scenario_config,
   fault_start_unix, fault_end_unix, load_generator_config, random_seed,
   ground_truth_root_cause_service, ground_truth_fault_type,
   expected_affected_services, collection_duration_sec, converter_version.
6. Convert:
   `python -m faultline_data.adapters.otel_demo capture/ --incident-id otel-rec-cache-001`
7. Load it in the demo UI (`GET /api/v1/incidents` will list it) and run the
   TA-053 walkthrough (docs/demo-scenario.md) against real OTel data.

## Status

- Converter + scenario schema: implemented and validated (unit test with a
  miniature capture).
- Live capture: pending human run - requires Docker resources and ~20 minutes.
