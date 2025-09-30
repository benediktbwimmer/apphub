# Ticket Data Directory

The ticketing service now stores data in a SQLite database (`tickets.db`) that lives in this directory. The file is created on first run by `@apphub/ticketing` and is intentionally ignored from source control.

Delete the database if you need a clean slate, or point `TICKETING_TICKETS_DIR` at a different path when running local experiments.
