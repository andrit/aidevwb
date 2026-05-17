# Full-Stack Web Application — Reference Guide

## Common Architecture Patterns

### Layered Architecture
Separate concerns into layers: routes (HTTP handling), services (business logic), repositories (data access). Routes validate input and delegate to services. Services contain logic and delegate to repositories. Repositories talk to the database.

### API Design
REST endpoints follow resource naming: `GET /users`, `POST /users`, `GET /users/:id`, `PUT /users/:id`, `DELETE /users/:id`. Use HTTP status codes correctly: 200 OK, 201 Created, 400 Bad Request, 404 Not Found, 500 Internal Error.

### Authentication Patterns
JWT tokens are stateless (no server-side session store needed). Store the access token in memory or httpOnly cookies, never localStorage. Refresh tokens extend sessions without re-authentication. For server-rendered apps, session cookies are simpler than JWTs.

### Database Patterns
Use migrations for schema changes (never manual ALTER TABLE in production). Foreign keys enforce data integrity at the database level. Indexes on frequently queried columns (foreign keys, search fields, sort fields). Connection pooling prevents exhausting database connections under load.

### Error Handling
Centralized error handler catches all unhandled errors. Business logic errors return structured responses (not stack traces). Validation errors return field-level detail. Log errors with context (request ID, user ID, operation).

### Testing Strategy
Unit tests for pure business logic (no database, no HTTP). Integration tests for API endpoints (real database, real HTTP). Test the happy path, edge cases, and error cases. Use factories or fixtures for test data.

## Directory Structure Convention

```
src/
├── routes/          — HTTP handlers
├── services/        — business logic
├── models/          — database models/types
├── middleware/       — auth, validation, error handling
├── lib/             — shared utilities
└── __tests__/       — test files mirroring src/ structure
```
