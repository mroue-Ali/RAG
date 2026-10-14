from alembic import context
from sqlalchemy.engine import Connection

from app import models  # noqa: F401  (registers the tables on Base.metadata)
from app.config import get_config
from app.db import Base, connect


def run(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        # SQLite cannot alter most things in place; batch mode rebuilds the table instead.
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()


# The app hands over its own connection on startup. From the command line there
# is none, so open the configured database.
shared = context.config.attributes.get("connection")
if shared is not None:
    run(shared)
else:
    with connect(get_config()).engine.begin() as connection:
        run(connection)
