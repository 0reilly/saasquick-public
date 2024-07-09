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
const {spawn} = require('child_process');
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
        let actions = await this.getAvailableActions(llm, io);
        for (const action of actions) {
            const newState = await this.applyAction(action, llm, io);

            const newNode = new Node(newState, this);
            this.children.push(newNode);
        }
    }

    async simulate(llm, io) {
        let state = this.state;
        while (!(await isTerminalState(state, llm, io))) {
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
${JSON.stringify(state.code, null, 2)}

Evaluate the completeness, correctness, and buildability of the generated code for a full-stack application. Focus on whether the application can build and run successfully, considering that MERN stack boilerplate code was provided as a starting point. Also assess how well the code implements the specific features and requirements outlined in the problem statement.

Evaluation Criteria:

1. Full-Stack Implementation (30% weight):
   - Are all necessary files present for both frontend and backend?
   - Is there a complete project structure (e.g., proper directory organization)?
   - Are core full-stack elements (server, client app, database connection) properly set up?
   - How well does the generated code integrate with the provided boilerplate?

2. Build and Run Readiness (20% weight):
   - Are all necessary dependencies correctly specified in package.json files?
   - Is the Docker setup (server/Dockerfile, client/Dockerfile, docker-compose.yml) complete and correct?
   - Are there any obvious errors that would prevent the application from building or running?

3. Problem-Specific Feature Implementation (40% weight):
   - To what extent does the code implement features specific to the problem statement?
   - Are there key features or requirements mentioned in the problem statement that are missing?
   - How well are the implemented features integrated into the overall application structure?

4. Code Quality and Best Practices (10% weight):
   - Does the code follow industry best practices and coding standards?
   - Is there proper error handling and input validation?
   - Is the code modular, reusable, and well-organized?
   - Are there comments or documentation to explain complex parts of the code?

Provide a score between 0 and 1 for each criterion based on the evaluation, along with a brief explanation.
Then, calculate the overall weighted score using the provided weights.

Use the following format for the response:
<thinking>
For the problem statement, let's evaluate the generated code:

1. Full-Stack Implementation ({score1}):
   - Present files: [list of key files present]
   - Missing files: [list of key files missing, if any]
   - Full-stack elements: [brief assessment of core elements]
   - Integration with boilerplate: [assessment of how well new code integrates with provided boilerplate]

2. Build and Run Readiness ({score2}):
   - Dependencies: [assessment of package.json files]
   - Docker setup: [assessment of Docker configuration]
   - Potential build/run issues: [list any obvious problems]

3. Problem-Specific Feature Implementation ({score3}):
   - Implemented features: [list of problem-specific features implemented]
   - Missing features: [list of key features not yet implemented]
   - Feature integration: [assessment of how well features are integrated]

4. Code Quality and Best Practices ({score4}):
   - Coding standards adherence: [brief assessment]
   - Error handling and validation: [brief assessment]
   - Code organization and modularity: [brief assessment]
   - Documentation and comments: [brief assessment]

Overall Weighted Score: ({score1} * 0.3) + ({score2} * 0.2) + ({score3} * 0.4) + ({score4} * 0.1) = {final_score}
</thinking>
<json>
{final_score}
</json>

Consider all the mentioned criteria when determining the score.
Do not include any additional information or text in the response.
`;

            const evaluationResponse = await anthropic.messages.create({
                model: 'claude-3-5-sonnet-20240620',
                max_tokens: 4096,
                messages: [{role: 'user', content: evaluationPrompt}],
            });

            const responseText = extractResponseText(evaluationResponse);
            console.log('Evaluation LLM output:', responseText);

            const thinkingText = extractThinkingFromText(responseText);
            console.log('evaluation Thinking:', thinkingText)
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

    You are working on a modern MERN (MongoDB, Express, React, Node.js) stack project. Your goal is to generate code for all essential components, ensuring a well-structured and efficient full-stack application.

    Focus on creating components that:
    0. Dockerize the application for easy deployment (client/Dockerfile, server/Dockerfile, docker-compose.yml)
    1. Adhere to MERN stack best practices
    2. Implement clean, maintainable code for both frontend and backend
    3. Utilize Tailwind CSS for styling on the frontend
    4. Use functional React components with hooks
    5. Implement proper routing with react-router-dom
    6. Follow modern Express.js patterns on the backend
    7. Use Mongoose for MongoDB interactions
    8. Implement proper error handling and validation
    9. Provide a complete and comprehensive readme for the customer

    Essential Components Checklist (generate code for each):

    1. Frontend (React):
       [ ] client/src/components/: Create functional React components with hooks and Tailwind CSS
       [ ] client/src/pages/: Implement page-level components
       [ ] client/src/hooks/: Custom React hooks for shared logic
       [ ] client/services/: API service functions for backend communication
       [ ] client/Dockerfile: Docker configuration for the frontend
       [ ] client/package.json: Update dependencies and scripts
       [ ] client/public/index.html: Main HTML file with necessary scripts
       [ ] client/src/App.js: Main application component with routing
       [ ] client/src/index.js: Entry point for React application
       [ ] clinet/src/index.css: Global CSS styles
       [ ] client/src/tailwind.config.js: Tailwind CSS configuration

    2. Backend (Express, Node.js):
       [ ] server/server.js: Main server file with Express setup
       [ ] server/routes/: API routes for the application
       [ ] server/controllers/: Business logic for routes
       [ ] server/models/: Mongoose models for data structures
       [ ] server/middleware/: Custom middleware functions
       [ ] server/config/: Configuration files (e.g., database connection)
       [ ] server/package.json: Dependencies and scripts
       [ ] server/Dockerfile: Docker configuration for the backend

    3. Database (MongoDB):
       [ ] Implement Mongoose schemas
       [ ] Set up database connection and error handling

    4. Authentication:
       [ ] Implement JWT-based authentication
       [ ] Create login and registration functionality

    5. Project Root:
       [ ] README.md: Thorough and complete Project documentation
       [ ] Update package.json with necessary dependencies for both frontend and backend
       [ ] docker-compose.yml: For easy deployment and development
       [ ] .env: Template for environment variables
       
    Generate a list of actions to create or update these components. Each action should produce code for a specific file or component.

    Use Chain of Thought within <thinking> tags to analyze the current project state and determine the most critical actions.
    
    Example response:
    <thinking>
    1. Analyze the current project structure:
       - Existing components: [list components present in the current code]
       - Missing or outdated components: [list components needing implementation or updates]

    2. Evaluate the implementation status:
       - Frontend: [assess current React component structure, Tailwind CSS usage, and routing]
       - Backend: [evaluate API structure, controllers, models, and authentication]
       - Database: [check MongoDB integration and Mongoose usage]
       - DevOps: [assess README.md, Docker setup and environment configuration]

    3. Determine the most critical actions:
       - Actions to improve or create essential frontend and backend components
       - Actions to enhance database integration and models
       - Actions to implement or improve authentication
       - Actions to update project configuration and DevOps setup

    Based on this analysis, here are the most important actions to improve the MERN stack project:
    [List 5-10 critical actions, focusing on both frontend and backend improvements]
    </thinking>
    <json>
    [
      {
        "action": "Create client/Dockerfile",
        "category": "DevOps",
        "description": "Set up Docker configuration for the frontend application."
        },
        {
        "action": "Create server/Dockerfile",
        "category": "DevOps",
        "description": "Define Docker configuration for the backend server."
        },
        {
        "action": "Create docker-compose.yml",
        "category": "DevOps",
        "description": "Compose file for running the application with Docker."
        },
      {
        "action": "Create thorough README.md",
        "category": "Project Documentation",
        "description": "Provide detailed documentation for the project, including setup instructions, API endpoints, and usage examples."
      {
        "action": "Create/Update client/src/components/SomeComponent.js",
        "category": "Frontend",
        "description": "Generate a functional React component using hooks and Tailwind CSS for styling."
      },
      {
        "action": "Create/Update server/controllers/someController.js",
        "category": "Backend",
        "description": "Implement controller functions with proper error handling and validation."
      },
      {
        "action": "Create/Update server/models/SomeModel.js",
        "category": "Backend",
        "description": "Define Mongoose schema for a new data model with appropriate fields and methods."
      },
      {
        "action": "Update server/routes/api.js",
        "category": "Backend",
        "description": "Add new API routes and integrate with controllers, including authentication middleware where necessary."
      },
      {
        "action": "Create client/src/hooks/useSomeHook.js",
        "category": "Frontend",
        "description": "Implement a custom React hook for shared logic across components."
      }
    ]
    </json>
    
    Do not include any additional information or text in the response.
  `;
            const actionsResponse = await anthropic.messages.create({
                model: 'claude-3-5-sonnet-20240620',
                max_tokens: 4096,
                messages: [{role: 'user', content: actionsPrompt}],
            });
            console.log('Available actions LLM output:', extractResponseText(actionsResponse));
            const actionsText = extractResponseText(actionsResponse);
            const thinkingText = extractThinkingFromText(actionsText);
            io.emit('phase_update', {phase: `Thinking: ${thinkingText}`})

            try {
                const actionsJson = extractJsonFromText(actionsText);
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

You are working with a modern MERN stack project. Apply the given action to create or update a component or file. Ensure that your changes align with MERN stack best practices for both frontend and backend development.

When implementing changes:
1. For React components, use functional components with hooks and Tailwind CSS for styling
2. Implement proper routing with react-router-dom where necessary
3. For Express routes and controllers, follow RESTful principles and implement proper error handling and validation
4. Use Mongoose for MongoDB interactions, including well-defined schemas and models
5. Implement clean code practices, including proper commenting and error handling
6. Ensure proper integration between frontend, backend, and database components
7. Consider scalability, performance, and security in your implementations
8. Use JWT for authentication where applicable
9. Make sure the path follows the standard structure (client/, server/, etc.)

Generate the code for the specified file.

Provide the updated code in a valid JSON format, enclosed in <json> tags. It will be parsed programmatically, so please ensure it is valid JSON.
Show your thinking step by step in the <thinking> tags.

IMPORTANT JSON FORMATTING INSTRUCTIONS:
1. Ensure all property names and string values are enclosed in double quotes.
2. Use backslashes to escape any double quotes or backslashes within string values.
3. For code snippets, escape newlines with \\n, tabs with \\t, and other special characters as needed.
4. Do not use single quotes for strings in the JSON.
5. Avoid using any unescaped control characters in the JSON.
6. Double-check that all brackets and braces are properly closed and matched.
7. Do not include any comments within the JSON structure.
8. Ensure that the entire JSON structure is valid and can be parsed by a standard JSON parser.

Example response:
<thinking>
To apply this action, I will:
1. Update the code in file1.js to include the new feature
2. Add a new file file2.js with the required code
</thinking>
<json>
{
    "code": {
        "client/src/components/file1.js": "import React from 'react';\\n\\nconst Component1 = () => {\\n  return (\\n    <div className=\\"p-4\\">\\n      <h1 className=\\"text-2xl font-bold\\">Updated Component</h1>\\n    </div>\\n  );\\n};\\n\\nexport default Component1;",
        "server/routes/file2.js": "const express = require('express');\\nconst router = express.Router();\\n\\nrouter.get('/api/data', (req, res) => {\\n  res.json({ message: 'New API endpoint' });\\n});\\n\\nmodule.exports = router;"
    }
}
</json>

Your response should only include the <thinking> and <json> sections. Ensure that the JSON within the <json> tags is fully valid and can be parsed without errors.`;


            try {
                const applyResponse = await anthropic.messages.create({
                    model: 'claude-3-5-sonnet-20240620',
                    max_tokens: 4096,
                    messages: [{role: 'user', content: applyPrompt}],
                });
                const responseText = applyResponse.content[0].text;
                console.log('Apply action LLM output:', responseText);

                const thinkingMatch = responseText.match(/<thinking>([\s\S]*?)<\/thinking>/);
                const jsonMatch = responseText.match(/<json>([\s\S]*?)<\/json>/);

                if (!jsonMatch) {
                    throw new Error('No JSON found in the response');
                }

                const thinkingText = thinkingMatch ? thinkingMatch[1].trim() : '';
                let updatedCodeJson = jsonMatch[1].trim();

                io.emit('phase_update', {phase: `Thinking: ${thinkingText}`});

                // Attempt to parse the JSON, if it fails, try to clean it up
                let parsedResponse;
                try {
                    parsedResponse = JSON.parse(updatedCodeJson);
                } catch (jsonError) {
                    console.error('Error parsing JSON:', jsonError);
                    // Attempt to clean up the JSON
                    updatedCodeJson = this.cleanJsonString(updatedCodeJson);
                    try {
                        parsedResponse = JSON.parse(updatedCodeJson);
                    } catch (cleanedJsonError) {
                        throw new Error('Invalid JSON format in LLM response, even after cleanup');
                    }
                }

                let updatedCode;
                if (parsedResponse.code && typeof parsedResponse.code === 'object') {
                    updatedCode = parsedResponse.code;
                } else if (typeof parsedResponse === 'object') {
                    updatedCode = parsedResponse;
                } else {
                    throw new Error('Invalid code object in LLM response');
                }

                const mergedCode = this.deepMerge(this.state.code || {}, updatedCode);
                console.log('merged code:', JSON.stringify(mergedCode, null, 2));
                return {...this.state, code: mergedCode};

            } catch (error) {
                console.error('Error in applyAction:', error);
                retries++;
                if (retries === maxRetries) {
                    return {
                        ...this.state,
                        error: `Failed to apply action after ${maxRetries} attempts: ${error.message}`
                    };
                }
                console.log(`Retrying... (Attempt ${retries})`);
            }
        }
        return {...this.state, error: 'Failed to apply action after exhausting all retries'};
    }

    deepMerge(target, source) {
        if (typeof target !== 'object' || typeof source !== 'object') return source;
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key] instanceof Object) {
                    target[key] = this.deepMerge(target[key] || {}, source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        }
        return target;
    }

    cleanJsonString(jsonString) {
        // Remove any potential leading/trailing non-JSON content
        jsonString = jsonString.replace(/^[^{]*/, '').replace(/[^}]*$/, '');

        // Replace any unescaped newlines within string values
        jsonString = jsonString.replace(/("(?:(?!(?<!\\)").)*")|[\n\r]/g, (match, group) => {
            if (group) {
                return match; // Keep string content unchanged
            }
            return ''; // Remove newlines outside strings
        });

        // Attempt to fix common JSON errors
        jsonString = jsonString
            .replace(/,\s*([\]}])/g, '$1') // Remove trailing commas
            .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // Ensure property names are in double quotes
            .replace(/\\/g, '\\\\') // Escape backslashes
            .replace(/\r?\n|\r/g, '\\n'); // Replace newlines with \n

        return jsonString;
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
        this.loadStateIfExists(rootNode); // Load state if it exists

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
        console.log('code: ', JSON.stringify(this.bestNode.state.code, null, 2));
        console.log('Best score:', this.bestScore);
        console.log('Best state code:', JSON.stringify(this.bestNode.state.code, null, 2));
    }

    loadStateIfExists(rootNode) {
        if (fs.existsSync(this.savePath)) {
            const stateData = JSON.parse(fs.readFileSync(this.savePath, 'utf-8'));
            this.deserializeNode(rootNode, stateData.rootNode);
            this.bestScore = stateData.bestScore;
            if (stateData.bestNode) {
                this.bestNode = new Node({});
                this.deserializeNode(this.bestNode, stateData.bestNode);
            }
            console.log('State loaded from file');
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


async function isTerminalState(state, llm, io) {
    const terminalStatePrompt = `
    Analyze the following project state and determine if it represents a complete, functional MERN stack application:

    Problem Statement: ${state.problemStatement}
    Project Type: ${state.projectType}
    Current Code:
    ${JSON.stringify(state.code, null, 2)}

    Consider the following criteria:
    1. Presence of all essential components (frontend, backend, database)
    2. Completeness of each component
    3. Proper integration between components
    4. Implementation of all key features mentioned in the problem statement

    Respond with 'true' if the state is terminal (i.e., the project is complete and functional), or 'false' if it's not.

    Use the following format for your response:
    <thinking>
    [Your analysis of the project state]
    </thinking>
    <json>
    {
      "isTerminal": true/false
    }
    </json>
    `;

    try {
        const response = await llm.messages.create({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 4096,
            messages: [{role: 'user', content: terminalStatePrompt}],
        });

        const responseText = extractResponseText(response);
        const resultJson = extractJsonFromText(responseText);
        const thinkingText = extractThinkingFromText(responseText);

        io.emit('phase_update', {phase: `Evaluating terminal state: ${thinkingText}`});

        const result = JSON.parse(resultJson);
        return result.isTerminal;
    } catch (error) {
        console.error('Error in isTerminalState:', error);
        return false;
    }
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

        const savePath = path.join('output', projectId, 'saved_state.json');

        if (fs.existsSync(savePath)) {
            console.log('Loading saved state...');
            const stateData = JSON.parse(fs.readFileSync(savePath, 'utf-8'));
            initialState = stateData.rootNode.state;
            currentIteration = stateData.iteration;
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
    
    You are working on a MERN (MongoDB, Express, React, Node.js) stack project. Your primary goal is to generate code for all essential components to ensure the project builds and runs successfully. Focus on creating a complete, buildable, and runnable project structure using ONLY the MERN stack technologies.

    IMPORTANT: Stick strictly to the MERN stack:
    - MongoDB for the database (NOT PostgreSQL or any SQL database)
    - Express.js for the backend framework (NOT any other backend framework)
    - React for the frontend (NOT Next.js or any other frontend framework)
    - Node.js as the runtime environment
    
    Do NOT introduce any technologies outside of the MERN stack, such as Prisma, Next.js, or any other frameworks or ORMs.
    

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
                const initialStateResponse = await anthropic.messages.create({
                    model: 'claude-3-5-sonnet-20240620',
                    max_tokens: 4096,
                    messages: [{role: 'user', content: initialStatePrompt}],
                });
                console.log('Initial state LLM output:', extractResponseText(initialStateResponse));
                const initialStateText = extractResponseText(initialStateResponse);
                const initialStateJson = extractJsonFromText(initialStateText);

                const thinkingText = extractThinkingFromText(initialStateText);
                io.emit('phase_update', {phase: `Thinking: ${thinkingText}`})
                try {
                    initialState = JSON.parse(initialStateJson);
                    initialState.code = {};

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
            let finalState = await mcts.search(currentIteration, initialState, 10, anthropic, io);
            console.log('finalState:', JSON.stringify(finalState, null, 2));

            // Identify missing components
            console.log('Identifying missing components...');
            io.emit('phase_update', {phase: 'Identifying missing components...'});
            const missingComponents = await identifyMissingComponents(finalState, anthropic, io);

            // Generate missing components
            if (missingComponents.length > 0) {
                console.log('Generating missing components...');
                io.emit('phase_update', {phase: 'Generating missing components...'});
                finalState = await generateMissingComponents(missingComponents, finalState, anthropic, io);
            }

            console.log('Final project state:', JSON.stringify(finalState, null, 2));

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

                try {
                    const fileStream = fs.createReadStream(zipPath);
                    await handleProjectGeneration(projectId, io, fileStream);

                } catch (error) {
                    console.error('Error in uploadProjectToS3:', error);
                    io.emit('project_generated', {projectId, error: 'Failed to generate download URL'});
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

async function generateMissingComponents(missingComponents, finalState, llm, io) {
    const updatedCode = {...finalState.code};

    for (const component of missingComponents) {
        const generationPrompt = `
        Generate code for the following missing component in our MERN stack project:

        File: ${component.file}
        Type: ${component.type}
        Description: ${component.description}

        Current Project Structure:
        ${JSON.stringify(updatedCode, null, 2)}

        Problem Statement: ${finalState.problemStatement}
        Project Type: ${finalState.projectType}

        Provide the generated code in the following format:
        <thinking>
        [Your thought process for generating the component]
        </thinking>
        <json>
        {
            "code": "Generated code content with escaped special characters in JSON string format"
        }
        </json>
        `;

        const generationResponse = await llm.messages.create({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 4096,
            messages: [{role: 'user', content: generationPrompt}],
        });

        const responseText = extractResponseText(generationResponse);
        const generatedCodeJson = extractJsonFromText(responseText);
        const thinkingText = extractThinkingFromText(responseText);

        io.emit('phase_update', {phase: `Generating ${component.file}: ${thinkingText}`});

        const parsedResponse = JSON.parse(generatedCodeJson);
        updatedCode[component.file] = parsedResponse.code;
    }

    return {...finalState, code: updatedCode};
}

async function identifyMissingComponents(finalState, llm, io) {
    const analysisPrompt = `
    Analyze the following MERN stack project and identify any missing essential components or files:

    Current Project Structure:
    ${JSON.stringify(finalState.code, null, 2)}

    Problem Statement: ${finalState.problemStatement}
    Project Type: ${finalState.projectType}

    Identify any missing essential components or files for a complete MERN stack project, including:
    1. Frontend React components
    2. Backend Express routes and controllers
    3. MongoDB models
    4. Authentication middleware
    5. API service files
    6. Configuration files
    7. Test files
    8. Any other crucial files for a production-ready MERN stack application

    Provide your analysis in the following format:
    <thinking>
    [Your analysis of the current project structure and reasoning about missing components]
    </thinking>
    <json>
    [
      {
        "file": "path/to/missing/file.js",
        "type": "Frontend/Backend/Database/DevOps",
        "description": "Description of the missing component and its purpose"
      },
      ...
    ]
    </json>
    `;

    const analysisResponse = await llm.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4096,
        messages: [{role: 'user', content: analysisPrompt}],
    });

    const responseText = extractResponseText(analysisResponse);
    const missingComponentsJson = extractJsonFromText(responseText);
    const thinkingText = extractThinkingFromText(responseText);
    console.log('Missing components analysis:', missingComponentsJson);
    io.emit('phase_update', {phase: `Analyzing project structure: ${thinkingText}`});

    return JSON.parse(missingComponentsJson);
}

async function handleProjectGeneration(projectId, io, fileStream) {
    try {
        const url = await uploadProjectToS3(projectId, fileStream);
        console.log('Project uploaded successfully. URL:', url);
        io.emit('project_generated', {projectId, url});
    } catch (error) {
        console.error('Error in project generation:', error);
        io.emit('project_generated', {projectId, error: error.message || 'An unknown error occurred'});
    } finally {
        io.emit('progress_update', {progress: 100});
        io.emit('phase_update', {phase: 'Project generation complete'});
    }
}

async function uploadProjectToS3(projectId, fileStream) {
    const uploadParams = {
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: `projects/${projectId}.zip`,
        Body: fileStream,
        ACL: 'public-read',
    };

    try {
        await s3.upload(uploadParams).promise();
        console.log('Project ZIP file uploaded to S3');

        const signedUrlExpireSeconds = 60 * 5; // URL expires in 5 minutes
        const url = s3.getSignedUrl('getObject', {
            Bucket: process.env.DO_SPACES_BUCKET,
            Key: `projects/${projectId}.zip`,
            Expires: signedUrlExpireSeconds
        });

        console.log('Generated pre-signed URL:', url);
        return url;
    } catch (error) {
        console.error('Error uploading project ZIP file to S3:', error);
        throw error; // Re-throw the error to be handled by the caller
    }
}

function saveCodeToFile(code, projectDir) {
    if (!code || typeof code !== 'object') {
        console.error('Invalid code structure:', code);
        return;
    }

    const saveCode = (filePath, fileContent) => {
        const fullPath = path.join(projectDir, filePath);
        const dirPath = path.dirname(fullPath);
        fs.mkdirSync(dirPath, {recursive: true});
        fs.writeFileSync(fullPath, fileContent);
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
