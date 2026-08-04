import os

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


def _pg_conn():
    # psycopg 3 connects to either scheme natively.
    return psycopg.connect(DATABASE_URL)


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
        ["users", "user_settings", "spending", "todos", "work_log", "schedule"],
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
    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print("Database initialized.")
