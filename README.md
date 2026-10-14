# rag

A personal knowledge base you can talk to. This is the core it will grow from: a
chat interface, a settings system, accounts, and a model layer that can run a
model three different ways. Retrieval over your own documents comes next.

There is one kind of instance. Every one has accounts, users with roles, and sign-in,
whether it runs on your laptop or on a server:

- An **account** owns the data: the model setup, the prompt and the settings now, the
  documents later, and a subscription some day.
- **Users** belong to an account and have a **role**. The owner can do everything,
  admins set up the model and manage users, members chat.
- **Superadmins** sit above every account and run the instance. The first person to
  open a new instance sets it up and becomes one.

Two settings in `backend/.env` decide what a particular server can do:

| | Your own machine (default) | A shared server |
| --- | --- | --- |
| `LOCAL_MODELS` | `true`: Local (transformers), LM Studio and APIs | `false`: APIs only. The local providers are still shown, disabled, so people see they exist |
| `OPEN_SIGNUP` | `false`: after setup, admins add people | `true`: anyone can create an account of their own |

Cloning the repository and running it gives you the first column with nothing to configure.

## What works today

- **Three ways to run a model**, each with its own saved configuration:
  - **Local** runs a Hugging Face model inside the backend with `transformers`, on GPU or CPU, with optional 4-bit or 8-bit quantization.
  - **LM Studio** lists the models you have downloaded and loads or unloads them through LM Studio's own API.
  - **OpenAI-compatible API** talks to any endpoint that speaks the OpenAI chat API, hosted or self-hosted.
- **Chat** with streaming replies, stop mid-answer, regenerate, Markdown and code rendering, per-reply token count and speed, and a fold-away view for a reasoning model's thinking.
- **Prompt templates** with `{{placeholders}}`, edited next to a live preview rendered by the same code path chat uses.
- **Settings** for sampling, response length, conversation history and streaming.
- **Accounts, users and roles**: first-run setup, adding and removing users, role changes and password resets, an admin page for superadmins, sessions in an HttpOnly cookie, and every account's data kept apart from every other's.
- Light and dark themes, and a layout that works down to phone width.

## Stack

| Part | Built with |
| --- | --- |
| Backend | FastAPI, SQLAlchemy 2, Alembic, Pydantic 2, PostgreSQL (SQLite fallback in development) |
| Model layer | `transformers` + `torch` (optional), LM Studio REST API, OpenAI SDK |
| Auth | Argon2 password hashing, server-side sessions, Google Identity Services |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, React Router |

## Layout

```
backend/
  main.py                 entry point for uvicorn
  app/
    main.py               app factory and startup
    config.py             environment configuration (.env)
    db.py, models.py      database connection and tables
    schemas.py            every request, response and settings shape
    api/                  HTTP routes: auth, account, admin, settings, llm, prompt, chat, health
    services/
      auth.py             setup, sign-up, passwords, Google, sessions
      accounts.py         users inside an account, and the superadmin operations
      roles.py            roles and what each may do, in one map
      settings_store.py   per-account settings, API key encryption and redaction
      crypto.py, net.py   encryption at rest; which addresses a shared server may call
      prompt.py           template rendering and message assembly
      llm/                one module per provider, and the runtime that runs them
  migrations/             Alembic migrations, applied automatically on startup
  tests/                  pytest suite
frontend/
  src/
    pages/                Chat, Settings, Admin, and the setup and sign-in page
    components/           chat, settings, layout, and shared ui pieces
    state/                session, model, settings and chat state, held above the router
    lib/                  API client, types, theme, formatting
```

## Running it

On Windows, double-click `run.bat`.

The first time, it creates the Python environment, installs the backend and frontend
packages and makes a `backend/.env`; after that it only starts things. It opens the backend
and the frontend in their own windows and then the app in your browser. Close those two
windows to stop. The first page a new instance shows is setup, which creates your account.

You need Python 3.11 or newer and Node.js installed. The rest of this section is what
`run.bat` does, for other systems or for doing it by hand.

Backend, from `backend/`:

```bash
python -m venv venv
venv\Scripts\activate            # source venv/bin/activate on macOS and Linux
pip install -r requirements.txt
copy .env.example .env           # then set DATABASE_URL
uvicorn main:app --reload --port 8000
```

Frontend, from `frontend/`:

```bash
npm install
npm run dev
```

Then open http://localhost:5180. The dev server proxies `/api` to the backend on port 8000.
Interactive API docs are at http://localhost:8000/docs.

### The local provider

Running models in-process needs the optional dependencies:

```bash
pip install -r requirements-local.txt
```

For a CUDA build of torch, install it from the PyTorch index first; the file explains how.
LM Studio and OpenAI-compatible APIs need none of this.

### Database

PostgreSQL runs in Docker, from `docker-compose.yml` at the root; `run.bat` starts it, or
by hand: `docker compose up -d db`. It listens on `127.0.0.1:5434` and keeps its data in the
`rag-pgdata` volume. `DATABASE_URL` in `backend/.env` points at it. In development, if that database
cannot be reached, the app falls back to a SQLite file at `backend/data/rag.db` and says
so on the Admin page. With `APP_ENV=production` an unreachable database is an error
instead, so a deployment never writes to a throwaway file by accident.

The schema is managed with Alembic and brought up to date every time the backend starts.
After changing `app/models.py`, write the migration from `backend/`:

```bash
alembic revision --autogenerate -m "what changed"
```

### A shared server

Set these in the backend's environment:

```
APP_ENV=production
LOCAL_MODELS=false
OPEN_SIGNUP=true
SECRET_KEY=<a long random value, kept stable>
```

`SECRET_KEY` encrypts stored API keys, so the backend refuses to start in production
without one. `GOOGLE_CLIENT_ID` turns on Sign in with Google. `backend/.env.example`
describes every variable. Open the site yourself before anyone else does: the first visit
is setup, and whoever does it runs the instance.

To see how a server behaves on your own machine, set `LOCAL_MODELS=false` in
`backend/.env` and restart the backend. `ALLOW_PRIVATE_URLS=true` then still lets an API
provider point at LM Studio on localhost. Leave it off on a real deployment.

### Tests

From `backend/`:

```bash
pip install -r requirements-dev.txt
pytest
```

The suite covers setup, sign-up and sign-in, sessions, what each role may do, the
separation between accounts, the superadmin operations, what a shared server refuses, and
a chat turn end to end against a stand-in model.

## How a message travels

1. The browser posts the conversation to `POST /api/chat/stream`.
2. The backend works out who is asking, checks that their role allows chat, and loads their account's settings.
3. `services/prompt.py` renders the system prompt and the message template, and trims history to the configured length.
4. The provider streams tokens back, and the route relays them as server-sent events: `start`, `delta`, `reasoning`, then `done` or `error`.

The server keeps no conversation state.

## What an instance protects

- **Passwords** are hashed with Argon2. **Session tokens** are random, live in an HttpOnly cookie, and only their hash is stored. Changing or resetting a password signs that user out everywhere else.
- **Roles are checked on the server.** Every route asks for a permission, and the UI only hides what the server would refuse anyway.
- **Accounts are kept apart.** Settings belong to an account, and a user in another account cannot be seen or changed, only reported missing.
- **API keys** are encrypted at rest and never sent back to the browser, which only learns whether one is set.
- **Private addresses are refused** on a server without local models. People there choose the address the server calls, so anything that resolves to a loopback, private or link-local address is rejected, and redirects are not followed.

Known gaps, to close before opening an instance to the public: there is no rate limiting on
sign-in or sign-up, no password reset (accounts have no email), and the address check does
not defend against a DNS answer that changes between the check and the request. With
`LOCAL_MODELS` on, the one model held in memory belongs to the machine, so on an instance
with several accounts they share it; that setup is meant for one account.
