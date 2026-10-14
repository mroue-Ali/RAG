from fastapi import APIRouter

from . import account, admin, auth, chat, health, llm, prompt, settings

router = APIRouter(prefix="/api")
router.include_router(health.router)
router.include_router(auth.router)
router.include_router(account.router)
router.include_router(admin.router)
router.include_router(settings.router)
router.include_router(llm.router)
router.include_router(prompt.router)
router.include_router(chat.router)
