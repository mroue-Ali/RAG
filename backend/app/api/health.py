from dataclasses import asdict

from fastapi import APIRouter, Request

from ..schemas import DatabaseStatus, Health
from .deps import ConfigDep

router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request, config: ConfigDep) -> Health:
    info = asdict(request.app.state.db.info)
    # Public, so it does not say where the database lives. Superadmins see that at /api/admin/database.
    info.update(location="", error=None)
    return Health(app=config.app_name, env=config.app_env, database=DatabaseStatus(**info))
