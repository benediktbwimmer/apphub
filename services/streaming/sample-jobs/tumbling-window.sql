CREATE TABLE IF NOT EXISTS stream_orders (
  user_id STRING,
  amount DOUBLE,
  ts TIMESTAMP_LTZ(3),
  WATERMARK FOR ts AS ts - INTERVAL '5' SECOND
) WITH (
  'connector' = 'kafka',
  'topic' = 'apphub.streaming.input',
  'properties.bootstrap.servers' = '{{BROKER_BOOTSTRAP_SERVERS}}',
  'properties.group.id' = 'apphub-sample-job',
  'scan.startup.mode' = 'earliest-offset',
  'format' = 'json'
);

CREATE TABLE IF NOT EXISTS stream_aggregates (
  window_start TIMESTAMP_LTZ(3),
  window_end TIMESTAMP_LTZ(3),
  user_id STRING,
  total_amount DOUBLE,
  PRIMARY KEY (window_start, window_end, user_id) NOT ENFORCED
) WITH (
  'connector' = 'upsert-kafka',
  'topic' = 'apphub.streaming.aggregates',
  'properties.bootstrap.servers' = '{{BROKER_BOOTSTRAP_SERVERS}}',
  'key.format' = 'json',
  'value.format' = 'json'
);

INSERT INTO stream_aggregates
SELECT
  window_start,
  window_end,
  user_id,
  SUM(amount) AS total_amount
FROM TABLE(
  TUMBLE(TABLE stream_orders, DESCRIPTOR(ts), INTERVAL '1' MINUTE)
)
GROUP BY window_start, window_end, user_id;
