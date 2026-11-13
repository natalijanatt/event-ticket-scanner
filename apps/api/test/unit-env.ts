// Deterministic environment for unit tests – no .env file, no real services.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://unit:unit@localhost:1/unit?schema=unit';
process.env.JWT_ACCESS_SECRET = 'unit-test-secret-unit-test-secret-unit-test-secret';
process.env.TICKET_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PUBLIC_APP_URL = 'https://tickets.example.com';
process.env.EMAIL_MODE = 'mock';
process.env.EMAIL_QUEUE_MODE = 'inline';
