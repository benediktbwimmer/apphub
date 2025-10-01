/* WARNING: Script requires that SQLITE_DBCONFIG_DEFENSIVE be disabled */
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE repositories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    dockerfile_path TEXT NOT NULL,
    ingest_status TEXT NOT NULL DEFAULT 'seed',
    updated_at TEXT NOT NULL,
    last_ingested_at TEXT,
    ingest_error TEXT,
    ingest_attempts INTEGER NOT NULL DEFAULT 0,
    metadata_strategy TEXT NOT NULL DEFAULT 'auto',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
INSERT INTO repositories (id, name, description, repo_url, dockerfile_path, ingest_status, updated_at, last_ingested_at, ingest_error, ingest_attempts, metadata_strategy, created_at)
VALUES ('astro-notebook','Astro Notebook','Interactive notebook for Astro projects with live preview and docs integration.','https://github.com/example/astro-notebook','Dockerfile','ready','2024-04-20T10:15:00.000Z','2024-04-20T10:15:00.000Z',NULL,0,'auto','2025-09-19 04:49:56');
INSERT INTO repositories (id, name, description, repo_url, dockerfile_path, ingest_status, updated_at, last_ingested_at, ingest_error, ingest_attempts, metadata_strategy, created_at)
VALUES ('stream-sync','Stream Sync','Collaborative video room with synchronized playback and chat overlay.','https://github.com/example/stream-sync','deploy/docker/Dockerfile','ready','2024-04-19T14:42:00.000Z','2024-04-19T14:42:00.000Z',NULL,0,'auto','2025-09-19 04:49:56');
INSERT INTO repositories (id, name, description, repo_url, dockerfile_path, ingest_status, updated_at, last_ingested_at, ingest_error, ingest_attempts, metadata_strategy, created_at)
VALUES ('ml-dashboard','ML Dashboard','Monitor ML experiments with charts, alerts, and artifact browser.','https://github.com/example/ml-dashboard','Dockerfile','ready','2024-04-17T09:00:00.000Z','2024-04-17T09:00:00.000Z',NULL,0,'auto','2025-09-19 04:49:56');
INSERT INTO repositories (id, name, description, repo_url, dockerfile_path, ingest_status, updated_at, last_ingested_at, ingest_error, ingest_attempts, metadata_strategy, created_at)
VALUES ('kanban-live','Kanban Live','Real-time kanban board with multiplayer cursors and Slack integration.','https://github.com/example/kanban-live','ops/Dockerfile','ready','2024-04-16T11:30:00.000Z','2024-04-16T11:30:00.000Z',NULL,0,'auto','2025-09-19 04:49:56');
INSERT INTO repositories (id, name, description, repo_url, dockerfile_path, ingest_status, updated_at, last_ingested_at, ingest_error, ingest_attempts, metadata_strategy, created_at)
VALUES ('qs','qs','qs','https://github.com/benediktbwimmer/apphub','Dockerfile','failed','2025-09-19T10:58:13.911Z','2025-09-19T10:58:13.911Z','Dockerfile not found, unable to launch app',3,'auto','2025-09-19 10:57:41');
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    UNIQUE(key, value)
  );
INSERT INTO tags VALUES(1,'framework','astro',NULL);
INSERT INTO tags VALUES(2,'category','docs',NULL);
INSERT INTO tags VALUES(3,'language','typescript',NULL);
INSERT INTO tags VALUES(4,'runtime','node18',NULL);
INSERT INTO tags VALUES(5,'framework','nextjs',NULL);
INSERT INTO tags VALUES(6,'category','media',NULL);
INSERT INTO tags VALUES(7,'framework','streamlit',NULL);
INSERT INTO tags VALUES(8,'category','analytics',NULL);
INSERT INTO tags VALUES(9,'language','python',NULL);
INSERT INTO tags VALUES(10,'runtime','python3.11',NULL);
INSERT INTO tags VALUES(11,'framework','remix',NULL);
INSERT INTO tags VALUES(12,'category','productivity',NULL);
INSERT INTO tags VALUES(13,'runtime','node20',NULL);
INSERT INTO tags VALUES(14,'q','sqs',NULL);
CREATE TABLE repository_tags (
    repository_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'seed',
    PRIMARY KEY (repository_id, tag_id),
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );
INSERT INTO repository_tags VALUES('astro-notebook',1,'seed');
INSERT INTO repository_tags VALUES('astro-notebook',2,'seed');
INSERT INTO repository_tags VALUES('astro-notebook',3,'seed');
INSERT INTO repository_tags VALUES('astro-notebook',4,'seed');
INSERT INTO repository_tags VALUES('stream-sync',5,'seed');
INSERT INTO repository_tags VALUES('stream-sync',6,'seed');
INSERT INTO repository_tags VALUES('stream-sync',3,'seed');
INSERT INTO repository_tags VALUES('stream-sync',4,'seed');
INSERT INTO repository_tags VALUES('ml-dashboard',7,'seed');
INSERT INTO repository_tags VALUES('ml-dashboard',8,'seed');
INSERT INTO repository_tags VALUES('ml-dashboard',9,'seed');
INSERT INTO repository_tags VALUES('ml-dashboard',10,'seed');
INSERT INTO repository_tags VALUES('kanban-live',11,'seed');
INSERT INTO repository_tags VALUES('kanban-live',12,'seed');
INSERT INTO repository_tags VALUES('kanban-live',3,'seed');
INSERT INTO repository_tags VALUES('kanban-live',13,'seed');
INSERT INTO repository_tags VALUES('qs',14,'author');
CREATE TABLE ingestion_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    attempt INTEGER,
    commit_sha TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
  );
INSERT INTO ingestion_events VALUES(1,'qs','pending','Queued for ingestion',0,NULL,NULL,'2025-09-19T10:57:41.195Z');
INSERT INTO ingestion_events VALUES(2,'qs','processing','Ingestion started',1,NULL,NULL,'2025-09-19T10:57:41.206Z');
INSERT INTO ingestion_events VALUES(3,'qs','failed','Dockerfile not found, unable to launch app',1,'09df4e7253f88ff561725bbb2650ba20878333a9',886,'2025-09-19T10:57:42.094Z');
INSERT INTO ingestion_events VALUES(4,'qs','processing','Ingestion started',2,NULL,NULL,'2025-09-19T10:57:52.126Z');
INSERT INTO ingestion_events VALUES(5,'qs','failed','Dockerfile not found, unable to launch app',2,'09df4e7253f88ff561725bbb2650ba20878333a9',856,'2025-09-19T10:57:52.982Z');
INSERT INTO ingestion_events VALUES(6,'qs','processing','Ingestion started',3,NULL,NULL,'2025-09-19T10:58:13.048Z');
INSERT INTO ingestion_events VALUES(7,'qs','failed','Dockerfile not found, unable to launch app',3,'09df4e7253f88ff561725bbb2650ba20878333a9',862,'2025-09-19T10:58:13.911Z');
CREATE TABLE builds (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    status TEXT NOT NULL,
    logs TEXT,
    image_tag TEXT,
    error_message TEXT,
    commit_sha TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
  );
CREATE TABLE launches (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    build_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    instance_url TEXT,
    container_id TEXT,
    port INTEGER,
    resource_profile TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    stopped_at TEXT,
    expires_at TEXT,
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
    FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
  );
PRAGMA writable_schema=ON;
INSERT INTO sqlite_schema(type,name,tbl_name,rootpage,sql)VALUES('table','repository_search','repository_search',0,'CREATE VIRTUAL TABLE repository_search USING fts5(
    repository_id UNINDEXED,
    name,
    description,
    repo_url,
    tag_text,
    tokenize = ''porter''
  )');
CREATE TABLE IF NOT EXISTS 'repository_search_data'(id INTEGER PRIMARY KEY, block BLOB);
INSERT INTO repository_search_data VALUES(1,X'050009281d23');
INSERT INTO repository_search_data VALUES(10,X'000000000102020002010101020101');
INSERT INTO repository_search_data VALUES(137438953473,X'0000036203303131030601040a0105616c657274030601020702056e616c79740306010403030164010601020a010601020801060102080106010209020772746966616374030601020902047374726f01180101020102050103060104050105626f61726404060102050206726f77736572030601020a010863617465676f726901060104020106010402010601040201060104020204686172740306010206040174020601020902076f6c6c61626f72020601020203016d010601030401060103040106010304010601030402057572736f720406010208010964617368626f617264030c01010301030702026f63010c01020b01040301066578616d706c010601030501060103050106010305010601030503047065726903060102040103666f720106010204020872616d65776f726b01060104040106010404010601040401060104040106676974687562010601030301060103030106010303010601030301046874747001060103020106010302010601030201060103020106696e74656772010601020c030601020b050472616374010601020201066b616e62616e041201010201020401030601076c616e67756167010601040601060104060106010406010601040602036976650106010208030c01010301030701056d65646961020601040302016c031201010201020301030602066f6e69746f7203060102020208756c7469706c6179040601020701056e6578746a020601040502056f646531380106010409010601040905023230040601040903067465626f6f6b011201010301020301030701076f7665726c6169020601020a0108706c61796261636b02060102070206726576696577010601020903056f64756374040601040304046a656374010601020602057974686f6e0306010407070133030601040901047265616c040601020203036d6978040601040502036f6f6d02060102040205756e74696d01060104080106010408010601040801060104080105736c61636b040601020a0205747265616d020c01010201030607036c697403060104050203796e63020c010103010307050468726f6e0206010206010474696d65040601020302097970657363726970740106010407010601040702060104070105766964656f0206010203010477697468010601020701060102050106010205010601020604090c0c170e140c0d1e0b080e170c130c1c0b0a1e1c1a120b131d120c0e0d0f0c1109130e0f0d0c0b0c080b0a0a1b0c0f0a0d0b0b1a0c');
INSERT INTO repository_search_data VALUES(274877906945,X'0000006307306170706875620506010306010d62656e6564696b746277696d6d05060103050103636f6d05060103040106676974687562050601030301046874747005060103020101710506010402020173050c010102010202010273710506010403040d140a0d0b080b');
CREATE TABLE IF NOT EXISTS 'repository_search_idx'(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID;
INSERT INTO repository_search_idx VALUES(1,X'',2);
INSERT INTO repository_search_idx VALUES(2,X'',2);
CREATE TABLE IF NOT EXISTS 'repository_search_content'(id INTEGER PRIMARY KEY, c0, c1, c2, c3, c4);
INSERT INTO repository_search_content VALUES(1,'astro-notebook','Astro Notebook','Interactive notebook for Astro projects with live preview and docs integration.','https://github.com/example/astro-notebook','category:docs framework:astro language:typescript runtime:node18');
INSERT INTO repository_search_content VALUES(2,'stream-sync','Stream Sync','Collaborative video room with synchronized playback and chat overlay.','https://github.com/example/stream-sync','category:media framework:nextjs language:typescript runtime:node18');
INSERT INTO repository_search_content VALUES(3,'ml-dashboard','ML Dashboard','Monitor ML experiments with charts, alerts, and artifact browser.','https://github.com/example/ml-dashboard','category:analytics framework:streamlit language:python runtime:python3.11');
INSERT INTO repository_search_content VALUES(4,'kanban-live','Kanban Live','Real-time kanban board with multiplayer cursors and Slack integration.','https://github.com/example/kanban-live','category:productivity framework:remix language:typescript runtime:node20');
INSERT INTO repository_search_content VALUES(5,'qs','qs','qs','https://github.com/benediktbwimmer/apphub','q:sqs');
CREATE TABLE IF NOT EXISTS 'repository_search_docsize'(id INTEGER PRIMARY KEY, sz BLOB);
INSERT INTO repository_search_docsize VALUES(1,X'00020b0608');
INSERT INTO repository_search_docsize VALUES(2,X'0002090608');
INSERT INTO repository_search_docsize VALUES(3,X'0002090609');
INSERT INTO repository_search_docsize VALUES(4,X'00020a0608');
INSERT INTO repository_search_docsize VALUES(5,X'0001010502');
CREATE TABLE IF NOT EXISTS 'repository_search_config'(k PRIMARY KEY, v) WITHOUT ROWID;
INSERT INTO repository_search_config VALUES('version',4);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('tags',14);
INSERT INTO sqlite_sequence VALUES('ingestion_events',7);
CREATE INDEX idx_ingestion_events_repo_created
    ON ingestion_events(repository_id, datetime(created_at) DESC);
CREATE INDEX idx_builds_repo_created
    ON builds(repository_id, datetime(created_at) DESC);
CREATE INDEX idx_builds_status
    ON builds(status);
CREATE INDEX idx_launches_repo_created
    ON launches(repository_id, datetime(created_at) DESC);
CREATE INDEX idx_launches_status
    ON launches(status);
PRAGMA writable_schema=OFF;
COMMIT;
