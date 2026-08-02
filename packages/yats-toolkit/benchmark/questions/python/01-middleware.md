## Question: How does middleware work in FastAPI?

Find and explain the middleware stack: how middleware is registered, in what order it executes, and what built-in middleware FastAPI provides.

### Expected answer should cover:
- The `build_middleware_stack` method in `fastapi/applications.py`
- Order: ServerErrorMiddleware → user middleware → ExceptionMiddleware → AsyncExitStackMiddleware
- How `@app.middleware("http")` registers custom middleware
