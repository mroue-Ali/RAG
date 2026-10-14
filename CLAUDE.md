# rag

Personal knowledge base RAG system. The core exists (accounts, settings, model
loading, chat); retrieval over documents is not built yet.

## Layout
- backend/  - FastAPI API (PostgreSQL, settings in backend/.env)
- frontend/ - React + Vite web client
- mobile/   - React Native + Expo (not started)

## One kind of instance
There are no modes. Every instance, laptop or server, has sign-in, accounts, users and roles.
Ali was explicit that the project must not split into a local build and a hosted build again.
- **Account** owns the data (settings now, documents and subscriptions later). Every user belongs to exactly one.
- **Role** inside the account: owner, admin, member. What each may do is the `GRANTS` map in `services/roles.py`, and nowhere else.
- **Superadmin** is a flag on the user, above every account. The first-run setup user gets it.
- The first visit to an empty instance is setup (`POST /api/auth/setup`); after that sign-up is open or closed by `OPEN_SIGNUP`.

What a server can do is capability config, not a mode:
- `LOCAL_MODELS` (default true): transformers and LM Studio may run. When false they are still listed in `session.providers` with `available: false` and a reason, and the UI shows them disabled. Ali wants them visible on the server so people learn the feature exists. Do not hide them.
- The provider kind decides behaviour: local providers share one in-memory model (`LLMManager`); the API provider is stateless per request. That split lives in `services/llm/runtime.py` (`Runtime`) and `isLocal()` in `frontend/src/lib/providers.ts`.

## Running
- `run.bat` at the root is how Ali starts it, and the only launcher. It sets up whatever is missing, opens backend and frontend in their own windows and skips anything already running. Keep it working when ports, commands or setup steps change, and keep it ASCII with CRLF line endings.
- Those windows are Windows Terminal tabs here, so they cannot be found by window title (`taskkill /fi WINDOWTITLE`, `tasklist /v`); match the `cmd.exe` command line instead.
- Backend: `uvicorn main:app --reload --port 8000` from backend/, using backend/venv
- Database: Postgres 17 in Docker, `docker-compose.yml` at the root, service `db` on `127.0.0.1:5434` (user, password and db all `rag`, volume `rag-pgdata`). run.bat starts it. Leave the Windows PostgreSQL service on 5432 alone: its password is unknown and it is not this project's.
- To see server behaviour locally, set `LOCAL_MODELS=false` (and `OPEN_SIGNUP=true`) in backend/.env and restart
- Frontend: `npm run dev` from frontend/, serves http://localhost:5180 and proxies /api to :8000
- `.claude/launch.json` has `backend` and `frontend` as preview servers
- Checks: `pytest` in backend/; `npm run lint` and `npm run build` in frontend/

## Backend
- `app/schemas.py` holds every API and settings shape; `frontend/src/lib/types.ts` mirrors it by hand, so change both together.
- Every route except `/api/health` and `/api/auth/*` takes `UserDep` (or `SettingsDep`, which implies it). Routes that change something also take `dependencies=[require(Permission.X)]`; ask for a permission, never test a role. Superadmin routes take `SuperadminDep`.
- A new table that holds data needs an `account_id` (ON DELETE CASCADE), and its queries must filter on the signed-in user's account. Data that is personal to a user (profile, later their own conversations) takes a `user_id` instead.
- Account settings are `AppSettings`, one row per account and section, read and written only through `SettingsStore`, which encrypts the API key. The user's own name is `User.display_name`, which fills `{{user_name}}`. Env config (`app/config.py`) is separate.
- Rules about who may change which user (owner untouchable, no changing your own role) live in `services/accounts.py`, not in routes.
- Model providers live in `app/services/llm/`, one module each, behind `LLMProvider` in `base.py`. A new provider needs a module, a branch in `registry.py`, a `ProviderKind` entry, a place in `PROVIDER_ORDER`, and a decision on whether it is local (in `LOCAL_PROVIDERS`).
- Raise `LLMError` for anything the user should read (becomes a 409), `AuthError` for sign-in problems and `AccountError` for refused user management (both a 400). A missing or permission-refused request is an `HTTPException` 404 or 403.
- torch and transformers are optional (`requirements-local.txt`) and must only be imported inside functions in `transformers_local.py`.
- Prompt placeholders are defined once, in `VARIABLES` in `app/services/prompt.py`.
- Schema changes go through Alembic: edit `app/models.py`, then `alembic revision --autogenerate` from backend/, and read the generated file before keeping it (it has rendered the JSON column wrongly before). Migrations run on startup.
- Tests build their own app per test through `make_app` in `tests/conftest.py`; they never read backend/.env.

## Frontend
- Tailwind 4. Colors come only from the tokens in `src/index.css` (canvas, surface, sunken, raised, line, ink, accent, danger, warn); the dark theme is a second set of values for the same names.
- Shared controls in `components/ui/` set no width or font size, because callers pass those. Do not pass a utility that fights one the component already sets; add a variant instead. For a link that should look like a button, use `buttonClass`.
- State lives in `src/state/` providers above the router so it survives navigation. `AuthProvider` is outermost; the rest mount only once someone is signed in.
- Shape the UI by permission with `useCan('model.manage')` etc., never by role name. Settings sections declare who sees them in `SECTIONS` in `pages/SettingsPage.tsx`.
- Icons: `@phosphor-icons/react` only. Fonts: Geist and Geist Mono, self-hosted through fontsource.
- UI copy uses plain sentences and no em dashes.

## Notes for Claude
- Never commit backend/.env (or an old backend/.env.hosted, which nothing reads any more)
- Port 5173 is usually taken by another project on this machine, which is why this one is pinned to 5180.
- `npm run lint` occasionally takes several minutes on this machine for no visible reason. It is not hung.
