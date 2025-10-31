# Postgres to ClickHouse Migration Implementation

This document describes the implementation of periodic data migration from Postgres to ClickHouse in the timestore service.

## Overview

The migration system extends the existing lifecycle management framework to periodically migrate old data from Postgres metadata tables to ClickHouse for long-term storage and analytics. This helps prevent Postgres from overflowing with historical data while maintaining data accessibility.

## Architecture

### Components

1. **Lifecycle Operation Extension**: Added `postgres_migration` to the existing lifecycle operations
2. **Migration Logic**: Implemented in `src/lifecycle/maintenance.ts`
3. **Watermark Tracking**: Uses `migration_watermarks` table to track incremental migration progress
4. **Configuration**: Environment-based configuration with sensible defaults
5. **Monitoring**: Integrated with existing lifecycle metrics and observability

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
- `__migrated_at`: Migration timestamp
- `__source_table`: Original Postgres table name
- `__dataset_slug`: Dataset identifier
- `__partition_key`: ClickHouse partitioning information

### Error Handling

- **Transactional**: Each batch is processed in a Postgres transaction
- **Rollback**: Failed batches are rolled back without affecting watermarks
- **Retry**: Failed operations are retried on next lifecycle run
- **Monitoring**: Failures are tracked in lifecycle metrics

## Scheduling

### Default Schedule

- **Frequency**: Runs with other lifecycle operations (default: every 5 minutes)
- **Operations**: `['compaction', 'retention', 'postgres_migration']`
- **Concurrency**: Controlled by lifecycle job concurrency settings

### Manual Execution

```bash
# Run migration for specific dataset
tsx src/workers/lifecycleWorker.ts --once --dataset-id=<dataset-id> --operations=postgres_migration

# Test migration (dry run)
tsx src/tools/testPostgresMigration.ts --dry-run

# Test migration for specific dataset
tsx src/tools/testPostgresMigration.ts --dataset-id=<dataset-id>
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

### Unit Testing

```bash
# Test migration logic
npm test -- --grep "postgres.*migration"
```

### Integration Testing

```bash
# Test with real database
tsx src/tools/testPostgresMigration.ts --dataset-id=test-dataset

# Dry run test
tsx src/tools/testPostgresMigration.ts --dry-run
```

### Load Testing

```bash
# Generate test data and run migration
tsx src/tools/generateTestData.ts --records=100000
tsx src/tools/testPostgresMigration.ts --dataset-id=load-test
```

## Troubleshooting

### Common Issues

1. **Migration Stuck**: Check watermark timestamps and reset if needed
2. **ClickHouse Errors**: Verify ClickHouse connectivity and schema
3. **High Memory Usage**: Reduce batch size in configuration
4. **Slow Performance**: Check Postgres indexes on time columns

### Debugging

```bash
# Enable debug logging
export TIMESTORE_LOG_LEVEL=debug

# Check migration watermarks
psql -c "SELECT * FROM migration_watermarks WHERE dataset_id = 'your-dataset';"

# Check migrated data in ClickHouse
clickhouse-client -q "SELECT count(*) FROM migrated_data WHERE __source_table = 'dataset_access_audit';"
```

## Future Enhancements

1. **Compression**: Add data compression before ClickHouse write
2. **Parallel Processing**: Multi-table parallel migration
3. **Schema Evolution**: Handle schema changes in migrated data
4. **Data Validation**: Compare checksums between Postgres and ClickHouse
5. **Incremental Sync**: Real-time streaming for high-frequency tables
