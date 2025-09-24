# File Drop Example Dataset

The file drop watcher scenario uses this directory to simulate an inbox/archival workflow:

- `inbox/` — files placed here are detected by the watcher service. Drop sample files to see the workflow kick off automatically.
- `archive/` — the relocation workflow moves files here, preserving the relative directory structure.

Both directories contain `.gitkeep` placeholders so that the tree exists in the repository.
