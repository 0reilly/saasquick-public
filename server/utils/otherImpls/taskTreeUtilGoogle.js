const archiver = require('archiver');
const {anthropic} = require("../config");
const {exec} = require('child_process');
const AWS = require('aws-sdk');
const spacesEndpoint = new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT);
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
});
const {GoogleGenerativeAI} = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MAX_BUILD_ATTEMPTS = 3;

const fs = require('fs');
const path = require('path');

class Node {
    constructor(state, parent = null) {
        this.state = state;
        this.parent = parent;
        this.children = [];
        this.visits = 0;
        this.score = 0;
    }

    getUCBScore(explorationFactor) {
        if (this.visits === 0) {
            return Infinity;
        }
        const exploitationTerm = this.score / this.visits;
        const explorationTerm = Math.sqrt(Math.log(this.parent.visits) / this.visits);
        return exploitationTerm + explorationFactor * explorationTerm;
    }

    async expand(llm, io) {
        //use child process to run docker-compose up --build in the output directory and return the result
        let actions = await this.getAvailableActions(llm, io);
        //make sure actions is an array
        if (!Array.isArray(actions)) {
            actions = [actions];
        }

        for (const action of actions) {
            const newState = await this.applyAction(action, llm, io);

            const newNode = new Node(newState, this);
            this.children.push(newNode);
        }
    }

    async simulate(llm, io) {
        let state = this.state;
        while (!isTerminalState(state)) {
            //use child process to run docker-compose up --build in the output directory and return the result
            let actions = await this.getAvailableActions(llm, io);
            const randomAction = actions[Math.floor(Math.random() * actions.length)];
            state = await this.applyAction(randomAction, llm, io);
        }
        return await this.evaluateState(state, llm, io);
    }

    async evaluateState(state, llm, io) {
        console.log('evaluating state for ', JSON.stringify(state.code))
        try {
            const evaluationPrompt = `
Problem Statement: ${state.problemStatement}
Project Type: ${state.projectType}
Generated Code:
${JSON.stringify(state.code) ?? 'not available'}

The structure of the repo should be at the same level as a company's production codebase, including a thorough README and documentation to run and deploy the application. The project should follow the most appropriate stack given the details with Docker files in the frontend and backend, docker-compose, and DigitalOcean deployment configs.

   
Evaluate the quality, completeness, and feasibility of the generated code considering the following criteria:

1. Feature Implementation (40% weight):
   - Are all the key features from the problem statement implemented correctly?
   - Does each feature have the proper components, routes, and controllers?
   - Is the functionality complete and aligned with the requirements?

2. Code Structure and Organization (20% weight):
   - Is the code well-structured, modular, and organized?
   - Are the components, routes, and controllers properly defined and separated?
   - Are the package.json script commands correct for building, running, and testing the application?
   - Is the code readable and maintainable?

3. Production Readiness and Deployment (20% weight):
   - Is the code production-ready and deployable on DigitalOcean?
   - Are the Dockerfiles, docker-compose, and deployment configurations properly set up?
   - Are the package.json script commands correct for building, running, and testing the application?
   - Are the necessary dependencies and packages included and up to date?

4. Error Handling and Edge Cases (10% weight):
   - Is the error handling implemented correctly?
   - Are potential edge cases and exceptions handled gracefully?

5. Documentation and README (10% weight):
   - Is the code well-documented with comments and explanations?
   - Is there a comprehensive README file with instructions to run and deploy the application?

Provide a score between 0 and 1 for each criterion based on the evaluation, along with a brief explanation.
Then, calculate the overall weighted score using the provided weights.

Use the following format for the response:
<thinking>
For the problem statement {problem statement}, lets review the existing files and missing files:

Files in the frontend code structure:
1. {file1}
2. {file2}
3. {file3}
4. {file4}
5. {file5}

Files in the backend code structure:
1. {file1}
2. {file2}
3. {file3}
4. {file4}
5. {file5}
6. {file6}


Files in the generated code:
1. {file1}
2. {file2}
3. {file3}
4. {file4}


The generated code is missing the following files:
1. {missing file1}
2. {missing file2}


Since this code is missing some key components, I will provide a lower score for the feature implementation criterion.

1. Feature Implementation ({score1}):
    - reason 1
    - reason 2
    - reason 3
    
2. Code Structure and Organization ({score2}):
    - reason 1
    - reason 2
    - reason 3
    
3. Production Readiness and Deployment ({score3}):
    - reason 1
    - reason 2
    - reason 3
    
4. Error Handling and Edge Cases ({score4}):
    - reason 1
    - reason 2
    - reason 3
    
5. Documentation and README ({score5}):
    - reason 1
    - reason 2
    - reason 3
    
Overall Weighted Score: ({score1} * 0.4) + ({score2} * 0.2) + ({score3} * 0.2) + ({score4} * 0.1) + ({score5} * 0.1) = {score}
</thinking>
<json>
{score}
</json>

Consider all the mentioned criteria when determining the score.
Do not include any additional information or text in the response.
`;
            const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});
            const result = await model.generateContent(evaluationPrompt);
            const response = await result.response;
            const responseText = response.text();
            console.log('Evaluation LLM output:', responseText);

            const thinkingText = extractThinkingFromText(responseText);
            const scoreText = extractJsonFromText(responseText);

            io.emit('phase_update', {phase: `Thinking: ${thinkingText}`})
            const score = parseFloat(scoreText);
            if (isNaN(score)) {
                throw new Error('Invalid score returned by the LLM');
            }
            return score;
        } catch (error) {
            console.error('Error evaluating state:', error);
            // Return a default score or handle the error appropriately
            return 0;
        }
    }

    async getAvailableActions(llm, io) {
        let maxRetries = 4;
        let retries = 0;

        while (retries < maxRetries) {
            const actionsPrompt = `
            Problem Statement: ${this.state.problemStatement}
            Project Type: ${this.state.projectType}
            Current Code:
            ${JSON.stringify(this.state.code, null, 2)}
            
            You are working with a SaaS boilerplate that uses the following stack:
            - Backend: Express, Node.js (MERN)
            - Frontend: React
            - Database: MongoDB
            - Containerization: Docker
            - Deployment: DigitalOcean

            Generate a list of possible actions or code modifications to improve the current code based on the problem statement and project type. The actions should focus on implementing the required features while maintaining the existing structure and conventions of the SaaS boilerplate.

            Consider the following aspects:
            1. Adding new models, views, and serializers in the backend
            2. Creating new React components and pages
            3. Updating existing components to include new functionality
            4. Modifying API endpoints and integrating them with the frontend
            5. Writing unit tests for new features
            6. Adding or modifying database migrations
            7. Updating Docker configurations if necessary
            8. Enhancing error handling and input validation
            9. Improving code organization and modularity
            10. Updating documentation and comments

            Provide a diverse set of actions that cover different aspects of the feature implementation process.
            Use Chain of Thought to think through your response step by step with <thinking> tags.
            
            Example:
            <thinking>
            For the problem statement {problem statement}, let's consider the current state of the codebase and the required features:

            1. Backend (Express, Node.js) considerations:
                - Create new models for {feature1} and {feature2}
                - Implement serializers and views for the new models
                - Update API endpoints to handle new features

            2. Frontend (React) considerations:
               - Create new components for {feature1} and {feature2}
               - Update existing pages to incorporate new features
               - Add new routes in the React Router configuration

            3. Database considerations:
               - Create migrations for new models
               - Consider indexing for performance optimization

            4. Integration and testing:
               - Ensure proper API integration between frontend and backend
               - Add unit tests for new functionality

            Based on these considerations, here are the available actions:
            1. Create new models for {feature1} and {feature2}
            2. Implement serializers and views for the new models
            3. Update API endpoints to handle new features
            4. Create React components for {feature1} and {feature2}
            5. Modify existing React pages to include new features
            6. Update React Router configuration
            7. Generate and apply database migrations
            8. Implement API integration in React components
            9. Add unit tests for new 
            10. Update documentation with new features and usage instructions
            </thinking>
            <json>
            [
                {
                    "action": "Create new models for {feature1} and {feature2}"
                },
                {
                    "action": "Implement serializers and views for the new models"
                },
                {
                    "action": "Update API endpoints to handle new features"
                },
                {
                    "action": "Create React components for {feature1} and {feature2}"
                },
                {
                    "action": "Modify existing React pages to include new features"
                },
                {
                    "action": "Update React Router configuration"
                },
                {
                    "action": "Generate and apply database migrations"
                },
                {
                    "action": "Implement API integration in React components"
                },
                {
                    "action": "Add unit tests for new features"
                },
                {
                    "action": "Update documentation with new features and usage instructions"
                }
            ]
            </json>
            
            Respond with a valid JSON array of actions, enclosed in <json> tags.
            Do not include any additional information or text in the response.
        `;
            const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});
            const result = await model.generateContent(actionsPrompt);
            const response = await result.response;
            const responseText = response.text();
            console.log('Available actions LLM output:', responseText);

            try {
                const actionsJson = extractJsonFromText(responseText);
                const thinkingText = extractThinkingFromText(responseText);
                io.emit('phase_update', {phase: `Thinking: ${thinkingText}`})

                return JSON.parse(actionsJson);
            } catch (error) {
                console.error('Error parsing JSON:', error);
                retries++;
                if (retries === maxRetries) {
                    console.error('Failed to parse JSON response after multiple retries. Skipping action.');
                    return [];
                }
                console.log(`Retrying... (Attempt ${retries})`);
            }
        }
    }

    async applyAction(action, llm, io) {
        console.log('code before applying action:', JSON.stringify(this.state.code, null, 2))
        const maxRetries = 4;
        let retries = 0;

        while (retries < maxRetries) {
            const applyPrompt = `
Problem Statement: ${this.state.problemStatement}
Project Type: ${this.state.projectType}
Current Code:
${JSON.stringify(this.state.code || {}, null, 2)}
Action to Apply:
${JSON.stringify(action, null, 2)}

You are working with a SaaS boilerplate that uses the following stack:
- Backend: Express, Node.js (MERN)
- Frontend: React
- Database: MongoDB
- Containerization: Docker
- Deployment: DigitalOcean

Apply the given action or code modification to the current code while considering the problem statement and project type. Ensure that your changes align with the existing structure and conventions of the SaaS boilerplate.

When implementing changes:
1. Follow the best practices for the MERN stack and Docker configurations
2. Maintain consistent coding style with the existing codebase
3. Use appropriate file naming conventions
4. Update imports and dependencies as necessary
5. Ensure proper integration between frontend and backend components
6. Consider security best practices, especially for user authentication and data handling

Generate the updated code for each file specified in the code structure.

Think through your solution logically step-by-step with <thinking></thinking> tags.
Provide the updated code in a valid JSON format, enclosed in <json> tags. It will be parsed and paid for so please make sure it is valid JSON.
Use the following format for the JSON response object:
<json>
{
    "code": {
        "path/to/file1.js": "Updated code content with escaped special characters in JSON string format",
        "path/to/file2.js": "Updated code content with escaped special characters in JSON string format"
    }
}
</json>
Make sure to:

Escape any special characters (e.g., newline characters) in the code snippets to ensure they are valid within the JSON string.
Double-check the generated JSON for any syntax errors or missing closing brackets/braces.
Provide the complete code content for each file, even if the action only modifies a specific part of the file.

Do not include any additional information or text in the response.
`;

            try {
                const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});
                const result = await model.generateContent(applyPrompt);
                const response = await result.response;
                const responseText = response.text();
                console.log('Apply action LLM output:', responseText);
                const updatedCodeJson = extractJsonFromText(responseText);
                const thinkingText = extractThinkingFromText(responseText);

                io.emit('phase_update', {phase: `Thinking: ${thinkingText}`})

                const parsedResponse = JSON.parse(updatedCodeJson);
                const updatedCode = parsedResponse.code || {};
                const mergedCode = deepMerge(this.state.code || {}, updatedCode);

                return {...this.state, code: mergedCode};

            } catch (error) {
                console.error('Error parsing JSON:', error);
                retries++;
                if (retries === maxRetries) {
                    return {...this.state, error: 'Failed to parse JSON response from LLM after multiple retries'};
                }
                console.log(`Retrying... (Attempt ${retries})`);
            }
        }

        function deepMerge(target, source) {
            for (const key in source) {
                if (source.hasOwnProperty(key)) {
                    if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                        target[key] = deepMerge(target[key] || {}, source[key]);
                    } else {
                        target[key] = source[key];
                    }
                }
            }
            return target;
        }
    }

    backpropagate(score) {
        this.visits += 1;
        this.score += score;
        if (this.parent) {
            this.parent.backpropagate(score);
        }
    }

    getBestChild(explorationFactor) {
        let bestScore = -Infinity;
        let bestChild = null;
        for (const child of this.children) {
            const score = child.getUCBScore(explorationFactor);
            if (score > bestScore) {
                bestScore = score;
                bestChild = child;
            }
        }
        return bestChild;
    }
}

class MCTS {
    constructor(explorationFactor = 1.4, saveInterval = 1, savePath = 'saved_state.json') {
        this.explorationFactor = explorationFactor;
        this.bestNode = null;
        this.bestScore = -Infinity;
        this.saveInterval = saveInterval;
        this.savePath = savePath;
    }

    async search(currentIteration, initialState, numIterations, llm, io) {
        const rootNode = new Node(initialState);
        this.loadStateIfExists(rootNode);

        // If we have a saved state with iterations >= 1, use the best node as the result
        if (currentIteration >= 1 && this.bestNode) {
            console.log('Using saved best node as final state...');
            return this.bestNode.state;
        }

        for (let i = currentIteration; i < numIterations; i++) {
            io.emit('phase_update', {phase: `Iteration ${i + 1} of ${numIterations}`});
            io.emit('progress_update', {progress: (i) / numIterations * 100});

            console.log(`Iteration ${i + 1}:`);
            let node = rootNode;

            // Selection
            while (node.children.length > 0) {
                node = node.getBestChild(this.explorationFactor);
            }

            // Expansion
            await node.expand(llm, io);

            // Simulation
            const score = await node.simulate(llm, io);

            // Backpropagation
            node.backpropagate(score);

            if (score > this.bestScore) {
                this.bestScore = score;
                this.bestNode = node;
            }

            // Save the state at intervals
            if ((i + 1) % this.saveInterval === 0) {
                this.saveState(rootNode, i + 1);
            }
        }

        io.emit('progress_update', {progress: 100});

        return this.bestNode.state;
    }

    saveState(rootNode, iteration) {
        const state = {
            rootNode: this.serializeNode(rootNode),
            bestNode: this.bestNode ? this.serializeNode(this.bestNode) : null,
            bestScore: this.bestScore,
            iteration
        };
        fs.writeFileSync(this.savePath, JSON.stringify(state, null, 2));
        console.log(`State saved at iteration ${iteration}`);
    }

    loadStateIfExists(rootNode) {
        if (fs.existsSync(this.savePath)) {
            const state = JSON.parse(fs.readFileSync(this.savePath, 'utf-8'));
            this.bestScore = state.bestScore;
            this.deserializeNode(rootNode, state.rootNode);
            console.log(`State loaded from ${this.savePath}`);
        }
    }

    serializeNode(node) {
        return {
            state: node.state,
            visits: node.visits,
            score: node.score,
            children: node.children.map(child => this.serializeNode(child))
        };
    }

    deserializeNode(node, serializedNode) {
        node.state = serializedNode.state;
        node.visits = serializedNode.visits;
        node.score = serializedNode.score;
        node.children = serializedNode.children.map(childData => {
            const child = new Node({});
            this.deserializeNode(child, childData);
            child.parent = node;
            return child;
        });
    }
}

const { spawn } = require('child_process');


function isTerminalState(state) {
    return state.code !== undefined;
}

async function solveProblem(problemStatement, projectType, io, projectId) {
    console.log(`Received problem statement: "${problemStatement}"`);
    console.log(`Project type: "${projectType}"`);
    console.log(`Project ID: "${projectId}"`);
    try {
        console.log('Analyzing problem statement using LLM...')
        io.emit('phase_update', {phase: 'Analyzing problem statement...'});
        io.emit('progress_update', {progress: 0});
        const projectDir = path.join('output', projectId);
        console.log('Creating project directory...');
        fs.mkdirSync(projectDir, {recursive: true});

        let initialState = {};
        let currentIteration = 0;
        let finalState = null;

        const savePath = path.join('output', projectId, 'saved_state.json');

        if (fs.existsSync(savePath)) {
            console.log('Loading saved state...');
            const stateData = JSON.parse(fs.readFileSync(savePath, 'utf-8'));

            initialState = stateData.rootNode.state;
            currentIteration = stateData.iteration;

            //load the best node
            finalState = stateData.bestNode;
        } else {
            console.log('Generating initial state using LLM...');
            let retry = true;
            while (retry) {
                const initialStatePrompt = `
    Problem Statement: ${problemStatement}
    Project Type: ${projectType}
   
    Generate the initial state for the given problem statement, project type.
    The structure of the repo should be at the same level as a company's production codebase, including a thorough README and documentation to run and deploy the application.
    The final repository will be a full stack production deployed web application with the features that align with the problem statement. Dockerize the application to make it easy to deploy and run on any machine.
    
    The initial state should include:
    - Problem statement
    - Project type
    - Key features and requirements
    - User stories

    Provide the initial state in a valid JSON format, enclosed in <json> tags.
    Use Chain of Thought to think through your response step by step with <thinking> tags.

    Example response:
    <thinking>
    I analyzed the problem statement and additional information to generate the initial state for the project.
    
    The project type is {project type} and the key features include:
    1. Feature 1
    2. Feature 2
    3. Feature 3
    
    The user stories are as follows:
    1. As a user, I want to...
    2. As an admin, I want to...
    3. As a visitor, I want to...
    
    Based on this information, I have created the initial state with the necessary files and configurations.
    </thinking>
    
    <json>
    {
        "problemStatement": "full problem statement with a list of features and the tech stack",
        "projectType": "Your project type here",
        "features": ["list of features"],
        "userStories": ["list of user stories"],
    }
    </json>

    Do not include any additional information or text in the response.
`;
                const model = genAI.getGenerativeModel({model: "gemini-1.5-flash"});
                const result = await model.generateContent(initialStatePrompt);
                const response = await result.response;
                const responseText = response.text();
                console.log('Initial state LLM output:', responseText);

                try {
                    const initialStateJson = extractJsonFromText(responseText);
                    const thinkingText = extractThinkingFromText(responseText);
                    io.emit('phase_update', {phase: `Thinking: ${thinkingText}`})

                    initialState = JSON.parse(initialStateJson);
                    initialState.code = {
                        "docker-compose.yml": "version: \"3\"\nservices:\n  client:\n    build: ./client\n    ports:\n      - \"3000:3000\"\n  server:\n    build: ./server\n    ports:\n      - \"5000:5000\"\n    environment:\n      - MONGODB_URI=mongodb://mongo:27017/mydatabase\n  mongo:\n    image: mongo:latest\n    ports:\n      - \"27017:27017\"\n    volumes:\n      - mongodb_data:/data/db\n\nvolumes:\n  mongodb_data: {}",
                        "client/package.json": "{\n  \"name\": \"mern-docker-client\",\n  \"version\": \"0.1.0\",\n  \"private\": true,\n  \"dependencies\": {\n    \"react\": \"^18.2.0\",\n    \"react-dom\": \"^18.2.0\"\n  },\n  \"devDependencies\": {\n    \"@babel/core\": \"^7.22.5\",\n    \"@babel/preset-env\": \"^7.22.5\",\n    \"@babel/preset-react\": \"^7.22.5\",\n    \"babel-loader\": \"^9.1.2\",\n    \"css-loader\": \"^6.8.1\",\n    \"style-loader\": \"^3.3.3\",\n    \"html-webpack-plugin\": \"^5.5.3\",\n    \"webpack\": \"^5.88.0\",\n    \"webpack-cli\": \"^5.1.4\",\n    \"webpack-dev-server\": \"^4.15.1\"\n  },\n  \"scripts\": {\n    \"start\": \"webpack serve --mode development\",\n    \"build\": \"webpack --mode production\"\n  }\n}",
                        "client/webpack.config.js": "const path = require('path');\nconst HtmlWebpackPlugin = require('html-webpack-plugin');\n\nmodule.exports = {\n  entry: './src/index.js',\n  output: {\n    path: path.resolve(__dirname, 'build'),\n    filename: 'bundle.js',\n  },\n  module: {\n    rules: [\n      {\n        test: /\\.js$/,\n        exclude: /node_modules/,\n        use: {\n          loader: 'babel-loader',\n          options: {\n            presets: ['@babel/preset-env', '@babel/preset-react'],\n          },\n        },\n      },\n      {\n        test: /\\.css$/,\n        use: ['style-loader', 'css-loader'],\n      },\n    ],\n  },\n  plugins: [\n    new HtmlWebpackPlugin({\n      template: './public/index.html',\n    }),\n  ],\n  devServer: {\n    static: {\n      directory: path.join(__dirname, 'public'),\n    },\n    port: 3000,\n  },\n};",
                        "client/src/index.js": "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\n\nconst root = ReactDOM.createRoot(document.getElementById('root'));\nroot.render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);",
                        "client/src/App.js": "import React, { useState, useEffect } from 'react';\n\nfunction App() {\n  const [message, setMessage] = useState('');\n\n  useEffect(() => {\n    fetch('http://localhost:5000')\n      .then(response => response.text())\n      .then(data => setMessage(data))\n      .catch(error => console.error('Error:', error));\n  }, []);\n\n  return (\n    <div className=\"App\">\n      <header className=\"App-header\">\n        <h1>MERN Docker Project</h1>\n        <p>{message}</p>\n      </header>\n    </div>\n  );\n}\n\nexport default App;",
                        "client/src/styles.css": "body {\n  font-family: Arial, sans-serif;\n  margin: 0;\n  padding: 0;\n  background-color: #f0f0f0;\n}\n\n.App {\n  text-align: center;\n}\n\n.App-header {\n  background-color: #282c34;\n  min-height: 100vh;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  font-size: calc(10px + 2vmin);\n  color: white;\n}\n\nh1 {\n  margin-bottom: 20px;\n}\n\np {\n  font-size: 18px;\n}",
                        "client/public/index.html": "<!DOCTYPE html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <title>MERN Docker Project</title>\n  </head>\n  <body>\n    <div id=\"root\"></div>\n  </body>\n</html>",
                        "client/Dockerfile": "FROM node:18\n\nWORKDIR /app\n\nCOPY package*.json ./\n\nRUN npm install\n\nCOPY . .\n\nRUN npm run build\n\nEXPOSE 3000\n\nCMD [\"npm\", \"start\"]",
                        "server/package.json": "{\n  \"name\": \"mern-docker-server\",\n  \"version\": \"1.0.0\",\n  \"description\": \"Express server for MERN Docker project\",\n  \"main\": \"server.js\",\n  \"scripts\": {\n    \"start\": \"node server.js\",\n    \"dev\": \"nodemon server.js\"\n  },\n  \"dependencies\": {\n    \"cors\": \"^2.8.5\",\n    \"express\": \"^4.17.1\",\n    \"mongoose\": \"^5.12.3\"\n  },\n  \"devDependencies\": {\n    \"nodemon\": \"^2.0.7\"\n  }\n}",
                        "server/server.js": "const express = require('express');\nconst mongoose = require('mongoose');\nconst cors = require('cors');\n\nconst app = express();\nconst PORT = process.env.PORT || 5000;\n\n// Middleware\napp.use(cors());\napp.use(express.json());\n\n// MongoDB connection\nmongoose.connect(process.env.MONGODB_URI, {\n  useNewUrlParser: true,\n  useUnifiedTopology: true,\n})\n.then(() => console.log('MongoDB connected'))\n.catch(err => console.log('MongoDB connection error:', err));\n\n// Sample route\napp.get('/', (req, res) => {\n  res.send('Hello from MERN Docker server!');\n});\n\napp.listen(PORT, () => {\n  console.log(`Server running on port ${PORT}`);\n});",
                        "server/Dockerfile": "FROM node:18\n\nWORKDIR /app\n\nCOPY package*.json ./\n\nRUN npm install\n\nCOPY . .\n\nEXPOSE 5000\n\nCMD [\"node\", \"server.js\"]",
                        "README.md": "# MERN Docker Project\n\nThis project is a MERN (MongoDB, Express, React, Node.js) stack application containerized with Docker.\n\n## Prerequisites\n\n- Docker\n- Docker Compose\n\n## Getting Started\n\n1. Clone the repository:\n   ```\n   git clone <repository-url>\n   cd mern-docker-project\n   ```\n\n2. Build and run the containers:\n   ```\n   docker-compose up --build\n   ```\n\n3. Access the application:\n   - Frontend: http://localhost:3000\n   - Backend: http://localhost:5000\n\n## Project Structure\n\n- `client/`: React frontend\n- `server/`: Express backend\n- `docker-compose.yml`: Docker Compose configuration\n\n## Development\n\nTo make changes:\n\n1. Modify the code in `client/` or `server/`\n2. Rebuild and run the containers:\n   ```\n   docker-compose up --build\n   ```\n\n## Production Deployment\n\nFor production deployment, consider:\n- Using environment variables for sensitive information\n- Configuring Nginx as a reverse proxy\n- Setting up SSL/TLS certificates\n- Implementing proper security measures\n\n## License\n\nThis project is licensed under the MIT License."
                    };

                    retry = false;
                } catch (error) {
                    console.error('Error parsing initial state JSON:', error);
                    // Handle the error or retry the LLM request
                }


            }
            console.log('Initial state generated successfully.');
            io.emit('phase_update', {phase: 'Initial state generated successfully.'});
        }



        try {
            const mcts = new MCTS(1.4, 1, savePath);

            console.log('Starting code generation using MCTS...');
            let finalState = await mcts.search(currentIteration, initialState, 20, anthropic, io);
            console.log('finalState:', JSON.stringify(finalState, null, 2));


            console.log('Saving generated code to files...');
            io.emit('phase_update', {phase: 'Saving generated code to files...'});

            saveCodeToFile(finalState.code, projectDir);
            console.log('Code saved successfully.');

            io.emit('phase_update', {phase: `Project Build Complete. Creating ZIP file for project`});
            console.log('Creating ZIP file for project');
            const outputDirPath = path.join('output', projectId);

            const zipPath = path.join(outputDirPath, 'project.zip');
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', {zlib: {level: 9}});

            output.on('close', async () => {

                console.log('ZIP file created successfully');
                const fileStream = fs.createReadStream(zipPath);
                const url = await uploadProjectToS3(projectId, io, fileStream);

                if (url) {
                    io.emit('project_generated', {projectId, url});
                } else {
                    io.emit('project_generated', {projectId});
                }


                io.emit('progress_update', {progress: 100});
                io.emit('phase_update', {phase: `Project ZIP file created successfully`});

            });

            archive.on('error', (err) => {
                throw err;
            });

            archive.pipe(output);
            archive.directory(projectDir, false);
            await archive.finalize();


            console.log('Autonomous software engineer completed the task successfully.');
            io.emit('phase_update', {phase: 'Autonomous software engineer completed the task successfully.'});
            return {projectId};
        } catch (error) {
            console.error('Error solving problem:', error);
            io.emit('error', {message: 'An error occurred while solving the problem.'});
        }

    } catch (error) {
        console.error('Error solving problem:', error);
        io.emit('error', {message: 'An error occurred while solving the problem.'});
    }
}

const loadBoilerplateCode = (projectDir, initialState) => {

    console.log('Loaded the following files into initialState.code:');
    Object.keys(initialState.code).forEach(file => console.log(file));
};



function deepMerge(target, source) {
    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
                target[key] = deepMerge(target[key] || {}, source[key]);
            } else {
                target[key] = source[key];
            }
        }
    }
    return target;
}




const uploadProjectToS3 = async (projectId, io, fileStream) => {
    const uploadParams = {
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: `projects/${projectId}.zip`,
        Body: fileStream,
    };

    try {
        // Upload the project ZIP file to DigitalOcean Spaces
        await s3.upload(uploadParams).promise();
        console.log('Project ZIP file uploaded to S3');

        const url = `https://${process.env.DO_SPACES_BUCKET}.nyc3.digitaloceanspaces.com/projects/${projectId}.zip`;
        return url;
    } catch (error) {
        console.error('Error uploading project ZIP file to S3:', error);
        io.emit('project_generated', {projectId});
    }
};


function saveCodeToFile(code, projectDir) {
    if (!code || typeof code !== 'object') {
        console.error('Invalid code structure:', code);
        return;
    }

    const saveCode = (filePath, fileContent) => {
        const fullPath = path.join(projectDir, filePath);
        const dirPath = path.dirname(fullPath);
        fs.mkdirSync(dirPath, { recursive: true });

        if (path.basename(filePath) === 'package.json' && typeof fileContent === 'string') {
            // Parse the JSON string, then stringify it properly
            const parsedContent = JSON.parse(fileContent);
            fs.writeFileSync(fullPath, JSON.stringify(parsedContent, null, 2));
        } else {
            fs.writeFileSync(fullPath, fileContent);
        }
    };

    Object.entries(code).forEach(([filePath, fileContent]) => {
        if (typeof fileContent === 'string' && fileContent.trim() !== '') {
            saveCode(filePath, fileContent);
        } else if (typeof fileContent === 'object') {
            saveCode(filePath, JSON.stringify(fileContent, null, 2));
        }
    });
}

const extractResponseText = (response) => {
    return response.content[0].text;
};

const extractJsonFromText = (text) => {
    const jsonRegex = /<json>(.*?)<\/json>/s;
    const match = text.match(jsonRegex);
    if (match && match[1]) {
        return match[1].trim();
    }
    return '{}';
};

const extractThinkingFromText = (text) => {
    //<thinking></thinking>
    const thinkingRegex = /<thinking>(.*?)<\/thinking>/s;
    const match = text.match(thinkingRegex);
    if (match && match[1]) {
        return match[1].trim();
    }

    return '';
};

module.exports = {
    solveProblem,
};
