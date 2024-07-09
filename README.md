# Autonomous Software Engineer Project

This project is a full-stack application that leverages AI to automatically generate software projects based on user descriptions. It uses a Monte Carlo Tree Search (MCTS) algorithm combined with Large Language Models (LLMs) to create customized software solutions.

## Features

- User authentication (registration and login)
- Project creation and management
- AI-powered code generation using MCTS and LLMs
- Stripe integration for payments
- Real-time updates using Socket.IO
- File storage and retrieval using AWS S3 (Digital Ocean Spaces)

## Technologies Used

- Backend:
    - Node.js
    - Express.js
    - MongoDB with Mongoose
    - Socket.IO for real-time communication
    - JWT for authentication
    - Stripe for payment processing
    - AWS SDK for S3 integration
- Frontend:
    - React (assumed, as the backend serves a React app)
- AI and Machine Learning:
    - Anthropic API for LLM integration
    - Custom MCTS implementation for code generation

## Prerequisites

- Node.js and npm
- MongoDB
- Stripe account
- AWS S3 compatible storage (Digital Ocean Spaces)
- Anthropic API key

## Setup

1. Clone the repository:
   ```
   git clone <repository-url>
   cd <project-directory>
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory and add the following variables:
   ```
   MONGODB_URI=<your-mongodb-uri>
   JWT_SECRET=<your-jwt-secret>
   STRIPE_SECRET_KEY=<your-stripe-secret-key>
   DO_SPACES_ENDPOINT=<your-do-spaces-endpoint>
   DO_SPACES_KEY=<your-do-spaces-key>
   DO_SPACES_SECRET=<your-do-spaces-secret>
   DO_SPACES_BUCKET=<your-do-spaces-bucket>
   ANTHROPIC_API_KEY=<your-anthropic-api-key>
   CLIENT_URL=<your-frontend-url>
   ```

4. Start the server:
   ```
   npm start
   ```

## API Endpoints

- POST `/register`: User registration
- POST `/login`: User login
- GET `/user`: Get user information (protected)
- POST `/api/projects`: Create a new project (protected)
- GET `/api/projects`: Get all projects for a user (protected)
- GET `/api/projects/:projectId`: Get details of a specific project (protected)
- DELETE `/api/projects/:projectId`: Delete a project (protected)
- POST `/build`: Start the project generation process (protected)
- GET `/download/:projectId`: Get download URL for a generated project (protected)
- POST `/create-checkout-session`: Create a Stripe checkout session for payment (protected)

## Webhook

The application includes a Stripe webhook (`/webhook`) to handle successful payments and update project status.

## Frontend

The frontend is assumed to be a React application. The backend serves the built React app from the `client/build` directory.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details.
