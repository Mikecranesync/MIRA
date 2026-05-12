"""FastAPI server for mira-seo."""

from fastapi import FastAPI

app = FastAPI(title="mira-seo", version="0.1.0")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}
