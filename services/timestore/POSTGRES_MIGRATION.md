# Postgres to ClickHouse Migration Implementation

This document describes the implementation of periodic data migration from Postgres to ClickHouse in the timestore service.

**Note** that all the bash commands below should be executed from this directory, **not** from the project root:

```bash
cd services/timestore/
```

## Overview

The migration system extends the existing lifecycle management framework to periodically migrate old data from Postgres metadata tables to ClickHouse for long-term storage and analytics. This helps prevent Postgres from overflowing with historical data while maintaining data accessibility.

## Architecture

### Components

1. **Lifecycle Operation Extension**: Added `postgres_migration` to the existing lifecycle operations
2. **Migration Logic**: Implemented in `src/lifecycle/maintenance.ts`
3. **Watermark Tracking**: Uses `migration_watermarks` table to track incremental migration progress
4. **Configuration**: Environment-based configuration with sensible defaults
5. **Monitoring**: Integrated with existing lifecycle metrics and observability
6. **Unit and Integration Tests**: Unit tests (`tests/postgresMigration.test.ts`) and a simulation tool (`src/tools/simulatePostgresMigration.ts`) with extensive command-line options

### Data Flow

```
Postgres Tables → Migration Logic → ClickHouse → Cleanup (after grace period)
                      ↓
                 Watermark Tracking
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TIMESTORE_POSTGRES_MIGRATION_ENABLED` | `true` | Enable/disable postgres migration |
| `TIMESTORE_POSTGRES_MIGRATION_BATCH_SIZE` | `10000` | Number of records to migrate per batch |
| `TIMESTORE_POSTGRES_MIGRATION_MAX_AGE_HOURS` | `168` (7 days) | Age threshold for migration |
| `TIMESTORE_POSTGRES_MIGRATION_GRACE_PERIOD_HOURS` | `24` | Grace period before cleanup |
| `TIMESTORE_POSTGRES_MIGRATION_TARGET_TABLE` | `migrated_data` | ClickHouse target table |
| `TIMESTORE_POSTGRES_MIGRATION_WATERMARK_TABLE` | `migration_watermarks` | Watermark tracking table |

### Configuration Schema

```typescript
postgresMigration: {
  enabled: boolean;
  batchSize: number;
  maxAgeHours: number;
  gracePeriodhours: number;
  targetTable: string;
  watermarkTable: string;
}
```

## Database Schema

### Migration Watermarks Table

```sql
CREATE TABLE migration_watermarks (
  dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  watermark_timestamp TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dataset_id, table_name)
);
```

## Migrated Tables

The following Postgres tables are included in the migration:

1. **dataset_access_audit** - Access audit logs
2. **lifecycle_audit_log** - Lifecycle operation audit logs  
3. **lifecycle_job_runs** - Job execution history

## Implementation Details

### Migration Process

1. **Watermark Check**: Retrieve last migration timestamp for each table
2. **Data Query**: Select records older than `maxAgeHours` but newer than watermark
3. **Batch Processing**: Process records in configurable batch sizes
4. **ClickHouse Write**: Write data to ClickHouse with metadata enrichment
5. **Postgres Update**: Mark records as migrated in Postgres
6. **Watermark Update**: Update migration watermark
7. **Cleanup**: Delete migrated records after grace period

### Data Enrichment

Migrated data includes additional metadata:
- `migrated_at`: Migration timestamp
- `source_table`: Original Postgres table name
- Standard ClickHouse writer metadata columns (`__dataset_slug`, `__partition_key`, etc.)

### Error Handling

- **Transactional**: Each batch is processed in a Postgres transaction
- **Rollback**: Failed batches are rolled back without affecting watermarks
- **Retry**: Failed operations are retried on next lifecycle run
- **Monitoring**: Failures are tracked in lifecycle metrics
- **Graceful Degradation**: Tables without metadata columns are handled safely
- **Dynamic Schema**: Automatically adapts to different table structures

## Scheduling

### Default Schedule

- **Frequency**: Runs with other lifecycle operations (default: every 5 minutes)
- **Operations**: `['compaction', 'retention', 'postgres_migration']`
- **Concurrency**: Controlled by lifecycle job concurrency settings

### Manual Execution

```bash
# Run migration for specific dataset
tsx src/workers/lifecycleWorker.ts --once --dataset-id=<dataset-id> --operations=postgres_migration

# Simulate migration (dry run)
tsx src/tools/simulatePostgresMigration.ts --dry-run

# Simulate migration migration for specific dataset
tsx src/tools/simulatePostgresMigration.ts --dataset-id=<dataset-id>
```

## Monitoring and Metrics

### Lifecycle Metrics

The migration integrates with existing lifecycle metrics:

```typescript
interface LifecycleMetricsSnapshot {
  operationTotals: {
    postgres_migration: {
      count: number;      // Number of migration runs
      bytes: number;      // Total bytes migrated
      partitions: number; // Number of table partitions processed
    }
  }
}
```

### Audit Logging

Migration operations are logged in the lifecycle audit system:

```typescript
{
  eventType: 'postgres_migration',
  payload: {
    table: string;
    recordsMigrated: number;
    bytes: number;
    watermark: string;
  }
}
```

## Performance Considerations

### Batch Size Tuning

- **Small Batches** (1K-5K): Lower memory usage, more frequent commits
- **Large Batches** (10K-50K): Better throughput, higher memory usage
- **Default**: 10K records provides good balance

### ClickHouse Optimization

- **Partitioning**: Data partitioned by dataset and source table
- **Compression**: Automatic compression reduces storage costs
- **TTL Policies**: ClickHouse TTL can be configured for automatic cleanup

### Postgres Impact

- **Read Load**: Migration queries use time-based indexes
- **Lock Duration**: Short transaction locks due to batch processing
- **Cleanup**: Gradual cleanup reduces impact on active workloads

## Testing

The postgres offloading implementation includes two different testing approaches:

### 1. Unit Tests (`tests/postgresMigration.test.ts`)
Automated tests that run with the test suite using embedded PostgreSQL:

```bash
# Run postgres migration unit tests directly
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true node --enable-source-maps --import tsx tests/postgresMigration.test.ts
```

### 2. Integration Test Tool (`src/tools/simulatePostgresMigration.ts`)
Manual testing tool for real-world scenarios and debugging:

```bash
# Create simulation data and run migration
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --create-test-data

# Dry run to see what would be migrated
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --dry-run

# Simulate migration for specific dataset
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --dataset-id=<dataset-id>

# Test with ClickHouse mock mode (recommended for development)
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true TIMESTORE_CLICKHOUSE_MOCK=true node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --create-test-data

# Test with shorter migration window (1 hour instead of 7 days)
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true TIMESTORE_CLICKHOUSE_MOCK=true TIMESTORE_POSTGRES_MIGRATION_MAX_AGE_HOURS=1 node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --create-test-data
```

### Load Testing

```bash
# Generate simulation data and run migration with ClickHouse mock
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true TIMESTORE_CLICKHOUSE_MOCK=true node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --create-test-data

# Test with larger batch sizes
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true TIMESTORE_CLICKHOUSE_MOCK=true TIMESTORE_POSTGRES_MIGRATION_BATCH_SIZE=50000 node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --create-test-data
```

## ClickHouse Database Access

The migration writes data to ClickHouse with the following default configuration:

### Default ClickHouse Configuration
- **Host**: `clickhouse` (configurable via `TIMESTORE_CLICKHOUSE_HOST`)
- **HTTP Port**: `8123` (configurable via `TIMESTORE_CLICKHOUSE_HTTP_PORT`)
- **Native Port**: `9000` (configurable via `TIMESTORE_CLICKHOUSE_NATIVE_PORT`)
- **Username**: `apphub` (configurable via `TIMESTORE_CLICKHOUSE_USER`)
- **Password**: `apphub` (configurable via `TIMESTORE_CLICKHOUSE_PASSWORD`)
- **Database**: `apphub` (configurable via `TIMESTORE_CLICKHOUSE_DATABASE`)

### Accessing ClickHouse Manually

```bash
# Connect to ClickHouse using clickhouse-client
clickhouse-client --host clickhouse --port 9000 --user apphub --password apphub --database apphub

# Or via HTTP interface
curl "http://clickhouse:8123/?user=apphub&password=apphub&database=apphub" -d "SELECT * FROM migrated_data LIMIT 10"

# Check migrated data
clickhouse-client --host clickhouse --port 9000 --user apphub --password apphub --database apphub \
  -q "SELECT count(*) FROM migrated_data WHERE source_table = 'dataset_access_audit'"

# View table structure
clickhouse-client --host clickhouse --port 9000 --user apphub --password apphub --database apphub \
  -q "DESCRIBE TABLE migrated_data"

# Check recent migrations
clickhouse-client --host clickhouse --port 9000 --user apphub --password apphub --database apphub \
  -q "SELECT source_table, count(*) as records, max(migrated_at) as latest_migration FROM migrated_data GROUP BY source_table"
```

### Local Development Setup

For local development and testing, you have several options:

#### Option 1: Mock Mode (Recommended for Development)
```bash
# Test migration logic without ClickHouse
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true TIMESTORE_CLICKHOUSE_MOCK=true \
  node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --create-test-data
```

#### Option 2: Real ClickHouse Instance
```bash
# Start ClickHouse with Docker
docker run -d --name clickhouse-server --ulimit nofile=262144:262144 -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server

# Then run the migration simulation
TIMESTORE_CLICKHOUSE_HOST=localhost REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true \
  node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --create-test-data
```

#### Option 3: Full Docker Setup
```bash
# Start both PostgreSQL and ClickHouse
docker run -d --name apphub-postgres -p 5432:5432 -e POSTGRES_DB=apphub -e POSTGRES_USER=apphub -e POSTGRES_PASSWORD=apphub postgres:16-alpine
docker run -d --name clickhouse-server --ulimit nofile=262144:262144 -p 8123:8123 -p 9000:9000 clickhouse/clickhouse-server

# Run migration with real databases
TIMESTORE_CLICKHOUSE_HOST=localhost REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true \
  node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --create-test-data
```

**Note**: Without ClickHouse, migration will fail with connection errors like `getaddrinfo EAI_AGAIN clickhouse`. This indicates the migration logic is working correctly but cannot connect to ClickHouse.

## Troubleshooting

### Common Issues

1. **Migration Stuck**: Check watermark timestamps and reset if needed
2. **ClickHouse Connection Errors**: Verify ClickHouse is running and accessible
3. **High Memory Usage**: Reduce batch size in configuration
4. **Slow Performance**: Check Postgres indexes on time columns
5. **No Records Migrated**: Ensure datasets have published manifests

### Debugging

```bash
# Enable debug logging
export TIMESTORE_LOG_LEVEL=debug

# Check migration watermarks in PostgreSQL
psql -c "SELECT * FROM migration_watermarks WHERE dataset_id = 'your-dataset';"

# Check what data exists to migrate
psql -c "SELECT dataset_id, count(*) FROM dataset_access_audit WHERE created_at <= NOW() - INTERVAL '7 days' GROUP BY dataset_id;"

# Check migrated data in ClickHouse (if accessible)
clickhouse-client --host clickhouse --port 9000 --user apphub --password apphub --database apphub \
  -q "SELECT count(*) FROM migrated_data WHERE source_table = 'dataset_access_audit';"

# Check for datasets with published manifests
psql -c "SELECT d.id, d.slug, COUNT(dm.id) as manifest_count FROM datasets d LEFT JOIN dataset_manifests dm ON d.id = dm.dataset_id AND dm.status = 'published' GROUP BY d.id, d.slug;"
```

### Migration Status Verification

```bash
# Check if migration is finding data to process
REDIS_URL=inline APPHUB_ALLOW_INLINE_MODE=true node --enable-source-maps --import tsx src/tools/simulatePostgresMigration.ts --dry-run

# Monitor migration progress in logs
tail -f /path/to/timestore/logs | grep postgres_migration
```

## Future Enhancements

1. **Compression**: Add data compression before ClickHouse write
2. **Parallel Processing**: Multi-table parallel migration
3. **Schema Evolution**: Handle schema changes in migrated data
4. **Data Validation**: Compare checksums between Postgres and ClickHouse
5. **Incremental Sync**: Real-time streaming for high-frequency tables
