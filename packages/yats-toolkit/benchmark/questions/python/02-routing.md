## Question: How is routing implemented in FastAPI?

Trace how HTTP routes are registered, stored, and dispatched. Find the key classes and methods involved.

### Expected answer should cover:
- `APIRouter` class and its `add_api_route` method
- How decorators like `@app.get("/path")` register routes
- The relationship between `Route`, `APIRoute`, and path operations
- How dependencies are injected into route handlers
