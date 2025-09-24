# File Relocator Job Bundle

This bundle backs the file drop example scenario. It moves a single file from the watcher inbox to the archival directory, preserving the relative path structure and emitting a JSON summary with metrics that the watcher service can display.

## Parameters

| Name | Type | Description |
| --- | --- | --- |
| `dropId` | string | Identifier supplied by the watcher service. Used for traceability only. |
| `sourcePath` | string | Absolute path to the file that should be relocated. |
| `relativePath` | string | File path relative to the watch root. Determines the subdirectory structure below the archive. |
| `destinationDir` | string | Absolute path to the directory that should contain the relocated file. |
| `destinationFilename` | string (optional) | Override for the destination filename. Defaults to the basename derived from `relativePath`. |

The job creates the destination directory tree when needed, moves the file (falling back to copy + unlink on cross-device errors), and returns a payload shaped like:

```json
{
  "dropId": "drop-20240509-0001",
  "sourcePath": "/tmp/inbox/sample.txt",
  "destinationPath": "/tmp/archive/sample.txt",
  "relativePath": "sample.txt",
  "bytesMoved": 128,
  "startedAt": "2024-05-09T10:21:05.123Z",
  "completedAt": "2024-05-09T10:21:05.456Z",
  "durationMs": 333
}
```

## Local Testing

From the bundle directory:

```bash
npm install
npx tsx ../../apps/cli/src/index.ts jobs test . --input tests/sample-input.json
```

The provided sample input assumes the fixture directory created by the watcher service docs under `services/catalog/data/examples/file-drop/`.
