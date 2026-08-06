import os

import psycopg
from psycopg.rows import dict_row

DB_PATH = os.environ.get("MYLIFE_DB", os.path.join(os.path.dirname(__file__), "data.db"))
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# SQLite fallback for local dev (used when DATABASE_URL is not set).
# PostgreSQL is used when DATABASE_URL starts with postgresql:// / postgres://.
SQLITE_SCHEMAS = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        google_sub TEXT UNIQUE,
        google_access_token TEXT,
        google_refresh_token TEXT,
        google_email TEXT,
        google_scopes TEXT DEFAULT '',
        google_products TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER PRIMARY KEY,
        smtp_host TEXT,
        smtp_port INTEGER,
        smtp_user TEXT,
        smtp_password TEXT,
        daily_report INTEGER DEFAULT 0,
        report_time TEXT DEFAULT '18:00',
        report_last_sent TEXT,
        recipient TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        user_id INTEGER,
        purpose TEXT NOT NULL,
        product_id TEXT,
        expires_at INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS spending (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        description TEXT,
        date TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        completed INTEGER DEFAULT 0,
        priority TEXT DEFAULT 'medium',
        due_date TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS work_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        task TEXT NOT NULL,
        project TEXT,
        hours REAL NOT NULL,
        date TEXT NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        date TEXT NOT NULL,
        recurring INTEGER DEFAULT 0,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )
    """,
]

PG_TYPE = "postgresql" if DATABASE_URL and DATABASE_URL.startswith(("postgresql://", "postgres://")) else "sqlite"


class _HybridRow(dict):
    """A mapping row that also supports SQLite's positional row access."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


class _PostgresCursor:
    """Small compatibility layer for the existing SQLite-oriented queries.

    The API was written with ``?`` parameter placeholders and ``lastrowid``.
    psycopg uses ``%s`` and exposes inserted ids differently, so translating at
    the database edge keeps both supported production backends consistent.
    """

    def __init__(self, cursor, connection):
        self._cursor = cursor
        self._connection = connection

    @property
    def connection(self):
        return self._connection

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def lastrowid(self):
        self._cursor.execute("SELECT LASTVAL() AS id")
        row = self._cursor.fetchone()
        return row["id"]

    def execute(self, query, params=None):
        query = query.replace("?", "%s")
        self._cursor.execute(query, params)
        return self

    def fetchone(self):
        row = self._cursor.fetchone()
        return _HybridRow(row) if row is not None else None

    def fetchall(self):
        return [_HybridRow(row) for row in self._cursor.fetchall()]

    def __enter__(self):
        self._cursor.__enter__()
        return self

    def __exit__(self, *args):
        return self._cursor.__exit__(*args)

    def __getattr__(self, name):
        return getattr(self._cursor, name)


class _PostgresConnection:
    def __init__(self, connection):
        self._connection = connection

    def cursor(self, *args, **kwargs):
        return _PostgresCursor(self._connection.cursor(*args, **kwargs), self)

    def commit(self):
        return self._connection.commit()

    def close(self):
        return self._connection.close()

    def __enter__(self):
        self._connection.__enter__()
        return self

    def __exit__(self, *args):
        return self._connection.__exit__(*args)


def _pg_conn():
    # psycopg 3 connects to either scheme natively. Dict rows retain the
    # response shape used by SQLite, and the wrapper normalises the few
    # DB-API differences used throughout the API.
    return _PostgresConnection(psycopg.connect(DATABASE_URL, row_factory=dict_row))


def _pg_is_table(c, table):
    c.execute(
        "SELECT to_regclass(%s)",
        (table,),
    )
    return c.fetchone()[0] is not None


def _pg_has_column(c, table, col):
    c.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name=%s AND column_name=%s",
        (table, col),
    )
    return c.fetchone() is not None


def _pg_init(c):
    for table, ddl in zip(
        ["users", "user_settings", "oauth_states", "spending", "todos", "work_log", "schedule"],
        [
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                google_sub TEXT UNIQUE,
                google_access_token TEXT,
                google_refresh_token TEXT,
                google_email TEXT,
                google_scopes TEXT DEFAULT '',
                google_products TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (now()::text)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                smtp_host TEXT,
                smtp_port INTEGER,
                smtp_user TEXT,
                smtp_password TEXT,
                daily_report INTEGER DEFAULT 0,
                report_time TEXT DEFAULT '18:00',
                report_last_sent TEXT,
                recipient TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS oauth_states (
                state TEXT PRIMARY KEY,
                user_id INTEGER,
                purpose TEXT NOT NULL,
                product_id TEXT,
                expires_at BIGINT NOT NULL,
                created_at TEXT DEFAULT (now()::text)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS spending (
                id SERIAL PRIMARY KEY,
                user_id INTEGER,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                description TEXT,
                date TEXT NOT NULL,
                created_at TEXT DEFAULT (now()::text)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS todos (
                id SERIAL PRIMARY KEY,
                user_id INTEGER,
                title TEXT NOT NULL,
                description TEXT,
                completed INTEGER DEFAULT 0,
                priority TEXT DEFAULT 'medium',
                due_date TEXT,
                created_at TEXT DEFAULT (now()::text)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS work_log (
                id SERIAL PRIMARY KEY,
                user_id INTEGER,
                task TEXT NOT NULL,
                project TEXT,
                hours REAL NOT NULL,
                date TEXT NOT NULL,
                notes TEXT,
                created_at TEXT DEFAULT (now()::text)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS schedule (
                id SERIAL PRIMARY KEY,
                user_id INTEGER,
                title TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                date TEXT NOT NULL,
                recurring INTEGER DEFAULT 0,
                notes TEXT,
                created_at TEXT DEFAULT (now()::text)
            )
            """,
        ],
    ):
        if not _pg_is_table(c, table):
            c.execute(ddl)

    for table in ("spending", "todos", "work_log", "schedule"):
        if not _pg_has_column(c, table, "user_id"):
            c.execute(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER")
    if not _pg_has_column(c, "user_settings", "recipient"):
        c.execute("ALTER TABLE user_settings ADD COLUMN recipient TEXT")
    if not _pg_has_column(c, "users", "google_scopes"):
        c.execute("ALTER TABLE users ADD COLUMN google_scopes TEXT DEFAULT ''")
    if not _pg_has_column(c, "users", "google_products"):
        c.execute("ALTER TABLE users ADD COLUMN google_products TEXT DEFAULT '[]'")
    c.connection.commit()


def get_db():
    """Return a DB connection (sqlite3.Connection or psycopg Connection).

    Preserves the existing `conn = get_db(); c = conn.cursor(); conn.close()`
    call pattern used across the app.
    """
    if PG_TYPE == "postgresql":
        return _pg_conn()

    import sqlite3

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    if PG_TYPE == "postgresql":
        with _pg_conn() as conn:
            with conn.cursor() as c:
                _pg_init(c)
        return
    import sqlite3

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    c = conn.cursor()
    for schema in SQLITE_SCHEMAS:
        c.execute(schema)
    for table in ("spending", "todos", "work_log", "schedule"):
        cols = [r[1] for r in c.execute(f"PRAGMA table_info({table})").fetchall()]
        if "user_id" not in cols:
            c.execute(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER")
    cols = [r[1] for r in c.execute("PRAGMA table_info(user_settings)").fetchall()]
    if "recipient" not in cols:
        c.execute("ALTER TABLE user_settings ADD COLUMN recipient TEXT")
    user_cols = [r[1] for r in c.execute("PRAGMA table_info(users)").fetchall()]
    if "google_scopes" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN google_scopes TEXT DEFAULT ''")
    if "google_products" not in user_cols:
        c.execute("ALTER TABLE users ADD COLUMN google_products TEXT DEFAULT '[]'")
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print("Database initialized.")
