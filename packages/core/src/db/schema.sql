PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS uploaded_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_sec REAL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  display_name TEXT NOT NULL,
  duration_sec REAL,
  position INTEGER NOT NULL,
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (filename) REFERENCES uploaded_files(filename) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_position ON playlist(position);

CREATE TABLE IF NOT EXISTS listener_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  disconnected_at DATETIME,
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  device_type TEXT,
  device_os TEXT,
  device_browser TEXT,
  duration_sec INTEGER,
  referer TEXT
);

CREATE INDEX IF NOT EXISTS idx_listener_logs_disc ON listener_logs(disconnected_at);
