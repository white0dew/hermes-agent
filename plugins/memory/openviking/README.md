# OpenViking Memory Provider

Context database by Volcengine (ByteDance) with filesystem-style knowledge hierarchy, tiered retrieval, and automatic memory extraction.

## Requirements

- `pip install openviking`
- OpenViking server running (`openviking-server`)
- Embedding + VLM model configured in `~/.openviking/ov.conf`

## Setup

```bash
hermes memory setup    # select "openviking"
```

Or manually:
```bash
hermes config set memory.provider openviking
echo "OPENVIKING_ENDPOINT=http://localhost:1933" >> ~/.hermes/.env
```

## Config

All config via environment variables in `.env`:

| Env Var | Default | Description |
|---------|---------|-------------|
| `OPENVIKING_ENDPOINT` | `http://127.0.0.1:1933` | Server URL |
| `OPENVIKING_API_KEY` | (none) | API key (optional) |
| `OPENVIKING_ACCOUNT` | `default` | Tenant account ID |
| `OPENVIKING_USER` | `default` | Tenant user ID within the account |
| `OPENVIKING_AGENT` | `hermes` | Agent namespace sent to OpenViking |

## Notes

- With no API key, Hermes uses the local/default tenant and sends `OPENVIKING_ACCOUNT` / `OPENVIKING_USER` as configured.
- With a root key such as `ov-root-*`, Hermes also sends the configured tenant headers, including the literal `default` value. Some tenant-scoped OpenViking deployments reject root-key requests unless `X-OpenViking-Account` and `X-OpenViking-User` are present.
- With a non-root user key, the literal `default` tenant is still treated as implicit and the headers are omitted, so the server can derive tenancy from the key itself.

## Tools

| Tool | Description |
|------|-------------|
| `viking_search` | Semantic search with fast/deep/auto modes |
| `viking_read` | Read content at a viking:// URI (abstract/overview/full) |
| `viking_browse` | Filesystem-style navigation (list/tree/stat) |
| `viking_remember` | Store a fact for extraction on session commit |
| `viking_add_resource` | Ingest URLs/docs into the knowledge base |
