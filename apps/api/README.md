# Uncle Trading API

## Run with Docker Compose

SQLite is embedded in Python and does not require a separate database server or
local installation. Docker Compose runs the FastAPI service and stores its future
SQLite database in the persistent `api-data` volume at
`/data/uncle_trading.db`.

From this directory, start the API with the shared root environment file:

```sh
docker compose --env-file ../../.env up --build
```

The API is available at `http://localhost:8000`; its health endpoint is
`http://localhost:8000/health`. Set `API_PORT` to publish a different local
port. OpenAI settings can be supplied through the shell or a local `.env` file:

```sh
API_OPENAI_API_KEY=... API_OPENAI_MODEL=... docker compose up --build
```

`API_CORS_ORIGINS` accepts a comma-separated list of permitted local web origins
and defaults to `http://localhost:3000`. `API_DATABASE_PATH` defaults to the
container's persistent `/data/uncle_trading.db` path in Compose.

Stop the service with `docker compose --env-file ../../.env down`. The named volume is retained so
SQLite data survives container replacement. Running `docker compose down -v`
also deletes that local development data.

## Development maintenance

The Docker setup is part of the backend implementation and **must be updated as
development progresses**. Keep `Dockerfile`, `docker-compose.yml`,
`requirements.txt`, the root `.env.example`, exposed ports, health checks, environment
variables, mounted paths, and the startup command synchronized whenever the API
runtime changes.
