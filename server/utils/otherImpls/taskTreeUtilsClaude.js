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

const MAX_BUILD_ATTEMPTS = 0;

const fs = require('fs');
const path = require('path');


async function runDockerBuildTest(projectDir, io, anthropic) {
    console.log('Running Docker Compose build test...');
    io.emit('phase_update', {phase: 'Running Docker Compose build test...'});

    const buildProcess = spawn('docker-compose', ['build'], {cwd: projectDir});

    let buildOutput = '';
    let buildErrors = '';

    buildProcess.stdout.on('data', (data) => {
        buildOutput += data.toString();
        console.log(data.toString());
    });

    buildProcess.stderr.on('data', (data) => {
        buildErrors += data.toString();
        console.error(data.toString());
    });

    return new Promise((resolve, reject) => {
        buildProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error(`Docker Compose build failed with code ${code}`);
                io.emit('phase_update', {phase: 'Docker Compose build failed. Attempting to fix...'});

                // Attempt to fix the errors
                await fixDockerBuildErrors(buildErrors, projectDir, io, anthropic);
                resolve(false); // Indicate that there were errors
            } else {
                console.log('Docker Compose build successful');
                io.emit('phase_update', {phase: 'Docker Compose build successful'});
                resolve(true); // Indicate success
            }
        });
    });
}

async function fixDockerBuildErrors(buildErrors, projectDir, io, anthropic) {
    console.log('Analyzing build errors and attempting fixes...');

    const errorAnalysisPrompt = `
        Analyze the following Docker Compose build errors and suggest fixes:
        ${buildErrors}

        Do not include comments in your code.
        Provide your response in the following format:
        <thinking>
        [Your analysis of the errors and reasoning about fixes]
        </thinking>
        <json>
        {
            "fixes": [
                {
                    "file": "path/to/file",
                    "description": "Description of the fix",
                    "code": "Updated code content"
                },
                ...
            ]
        }
        </json>
    `;

    const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4096,
        messages: [{role: 'user', content: errorAnalysisPrompt}],
    });

    const responseText = extractResponseText(response);
    const thinkingText = extractThinkingFromText(responseText);
    io.emit('phase_update', {phase: `Analyzing errors: ${thinkingText}`});

    const fixesJson = extractJsonFromText(responseText);
    const fixes = JSON.parse(fixesJson).fixes;

    for (const fix of fixes) {
        const filePath = path.join(projectDir, fix.file);
        console.log(`Applying fix to ${filePath}`);
        io.emit('phase_update', {phase: `Applying fix to ${fix.file}`});

        try {
            await fs.writeFile(filePath, fix.code);
        } catch (error) {
            console.error(`Error writing to ${filePath}:`, error);
        }
    }

    console.log('Fixes applied. Retrying Docker Compose build...');
    io.emit('phase_update', {phase: 'Fixes applied. Retrying Docker Compose build...'});

    // Recursively call runDockerBuildTest to check if fixes resolved the issues
    return runDockerBuildTest(projectDir, io, anthropic);
}


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
   - Is the Docker setup (Dockerfiles, docker-compose.yml) complete and correct?
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
For the problem statement "${state.problemStatement}", let's evaluate the generated code:

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
            console.log('Evaluation LLM output:', extractResponseText(evaluationResponse));
            const responseText = extractResponseText(evaluationResponse);

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

    You are working on a modern MERN (MongoDB, Express, React, Node.js) stack project. Your goal is to generate code for all essential components, ensuring a well-structured and efficient full-stack application.

    Focus on creating components that:
    1. Adhere to MERN stack best practices
    2. Implement clean, maintainable code for both frontend and backend
    3. Utilize Tailwind CSS for styling on the frontend
    4. Use functional React components with hooks
    5. Implement proper routing with react-router-dom
    6. Follow modern Express.js patterns on the backend
    7. Use Mongoose for MongoDB interactions
    8. Implement proper error handling and validation

    Essential Components Checklist (generate code for each):

    1. Frontend (React):
       [ ] src/components/: Create functional React components with hooks and Tailwind CSS
       [ ] src/pages/: Implement page-level components
       [ ] src/hooks/: Custom React hooks for shared logic
       [ ] src/services/: API service functions for backend communication

    2. Backend (Express, Node.js):
       [ ] server.js: Main server file with Express setup
       [ ] routes/: API routes for the application
       [ ] controllers/: Business logic for routes
       [ ] models/: Mongoose models for data structures
       [ ] middleware/: Custom middleware functions
       [ ] config/: Configuration files (e.g., database connection)

    3. Database (MongoDB):
       [ ] Implement Mongoose schemas
       [ ] Set up database connection and error handling

    4. Authentication:
       [ ] Implement JWT-based authentication
       [ ] Create login and registration functionality

    5. Project Root:
       [ ] Update package.json with necessary dependencies for both frontend and backend
       [ ] docker-compose.yml: For easy deployment and development
       [ ] .env: Template for environment variables

    Generate a list of actions to create or update these components. Each action should produce code for a specific file or component.

    Use Chain of Thought to analyze the current project state and determine the most critical actions:

    <thinking>
    1. Analyze the current project structure:
       - Existing components: [list components present in the current code]
       - Missing or outdated components: [list components needing implementation or updates]

    2. Evaluate the implementation status:
       - Frontend: [assess current React component structure, Tailwind CSS usage, and routing]
       - Backend: [evaluate API structure, controllers, models, and authentication]
       - Database: [check MongoDB integration and Mongoose usage]
       - DevOps: [assess Docker setup and environment configuration]

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
        "action": "Create/Update src/components/SomeComponent.js",
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
        "action": "Create src/hooks/useSomeHook.js",
        "category": "Frontend",
        "description": "Implement a custom React hook for shared logic across components."
      }
    ]
    </json>

    Respond with a valid JSON array of actions, enclosed in <json> tags.
    Each action should focus on generating or updating code for a specific file or component in the MERN stack.
    Prioritize actions that contribute to a well-structured, modern full-stack application.
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


    Generate the updated or new code for the specified file.

    Think through your solution logically step-by-step with <thinking></thinking> tags.
    Provide the updated code in a valid JSON format, enclosed in <json> tags.

    Use the following format for the JSON response object:
    <json>
    {
      "code": {
        "path/to/file.js": "Updated code content with escaped special characters in JSON string format"
      }
    }
    </json>

    Ensure that:
    - the path follows the standard structure (client/, server/, etc.)
    - The code follows MERN stack best practices
    - Frontend components use Tailwind CSS for styling
    - Components are well-structured and maintainable
    - Backend code includes proper error handling and validation
    - Database interactions are efficient and secure
    - The code is scalable and easy to extend

    Do not include any additional information or text in the response.
  `;

            try {
                const applyResponse = await anthropic.messages.create({
                    model: 'claude-3-5-sonnet-20240620',
                    max_tokens: 4096,
                    messages: [{role: 'user', content: applyPrompt}],
                });
                console.log('Apply action LLM output:', extractResponseText(applyResponse));
                const responseText = extractResponseText(applyResponse);
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
        let rootNode = new Node(initialState);

        const stateLoaded = this.loadStateIfExists(rootNode);
        if (!stateLoaded) {
            console.log('Using initial state as root node');
            rootNode = new Node(initialState);
            currentIteration = 0;
            this.bestNode = null;
            this.bestScore = -Infinity;
        } else {
            console.log('Continuing from loaded state');
            // Ensure currentIteration is set correctly based on loaded state
            currentIteration = currentIteration || 0;
        }

        // If we have a saved state with iterations >= 1 and a valid best node, use it as the result
        if (currentIteration >= 1 && this.bestNode && this.bestNode.state) {
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

            if (i % 5 === 0) { // Every 5 iterations, for example
                await this.updateComponents(this.bestNode, llm, io);
            }

            // Save the state at intervals
            if ((i + 1) % this.saveInterval === 0) {
                this.saveState(rootNode, i + 1);
            }
        }

        io.emit('progress_update', {progress: 100});

        return this.bestNode && this.bestNode.state ? this.bestNode.state : initialState;
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

    async updateComponents(node, llm, io) {
        const updatePrompt = `
      Current project state:
      ${JSON.stringify(node.state, null, 2)}

      Review the current MERN stack project and suggest improvements for both frontend and backend components.
      Focus on:
      1. Enhancing the overall architecture and code structure
      2. Improving the integration between frontend, backend, and database
      3. Implementing best practices for each part of the MERN stack
      4. Adding new features or optimizing existing ones to align with the project goals
      5. Ensuring proper use of Tailwind CSS for styling on the frontend
      6. Implementing efficient and secure authentication mechanisms
      7. Optimizing database queries and API endpoints

      Provide your suggestions as a series of specific code updates for both frontend and backend.

      Use the following format for your response:
      <thinking>
      [Your analysis of the current project and reasoning about improvements]
      </thinking>
      <json>
      {
        "updates": [
          {
            "file": "path/to/file.js",
            "category": "Frontend/Backend/Database/DevOps",
            "description": "Description of the update",
            "code": "Updated code content"
          },
          ...
        ]
      }
      </json>
    `;

        try {
            const response = await llm.messages.create({
                model: 'claude-3-5-sonnet-20240620',
                max_tokens: 4096,
                messages: [{role: 'user', content: updatePrompt}],
            });

            const responseText = this.extractResponseText(response);
            const updatesJson = this.extractJsonFromText(responseText);

            let updates = [];
            try {
                const parsedUpdates = JSON.parse(updatesJson);
                if (parsedUpdates && Array.isArray(parsedUpdates.updates)) {
                    updates = parsedUpdates.updates;
                } else {
                    console.warn("Parsed updates is not in the expected format. Using empty array.");
                }
            } catch (parseError) {
                console.error("Error parsing updates JSON:", parseError);
                io.emit('phase_update', { phase: `Error parsing updates. Skipping component updates.` });
                return;
            }

            if (updates.length === 0) {
                console.warn("No updates suggested by the LLM.");
                io.emit('phase_update', { phase: `No updates suggested for components.` });
                return;
            }

            for (const update of updates) {
                if (update.file && update.code) {
                    node.state.code[update.file] = update.code;
                    console.log(`Updated file: ${update.file}`);
                } else {
                    console.warn(`Skipping invalid update:`, update);
                }
            }

            io.emit('phase_update', { phase: `Updated ${updates.length} component(s) for improved MERN stack integration` });
        } catch (error) {
            console.error('Error in updateComponents:', error);
            io.emit('phase_update', { phase: `Error updating components: ${error.message}` });
        }
    }

    extractResponseText(response) {
        return response.content[0].text;
    }

    extractJsonFromText(text) {
        const jsonRegex = /<json>(.*?)<\/json>/s;
        const match = text.match(jsonRegex);
        if (match && match[1]) {
            return match[1].trim();
        }
        return '{"updates": []}';
    }



    loadStateIfExists(rootNode) {
        if (fs.existsSync(this.savePath)) {
            console.log(`Attempting to load state from ${this.savePath}`);
            try {
                const stateData = JSON.parse(fs.readFileSync(this.savePath, 'utf-8'));

                // Check if it's the old format (direct state object) or new format (with rootNode)
                const rootNodeData = stateData.rootNode || stateData;

                if (rootNodeData && rootNodeData.state) {
                    console.log('Valid state data found. Loading state...');

                    // Load root node
                    this.deserializeNode(rootNode, rootNodeData);

                    // Load best node if available
                    if (stateData.bestNode) {
                        this.bestNode = new Node({});
                        this.deserializeNode(this.bestNode, stateData.bestNode);
                    } else if (stateData.state) {
                        // For backwards compatibility, create a best node from the main state
                        this.bestNode = new Node(stateData.state);
                    }

                    // Load best score
                    this.bestScore = stateData.bestScore || rootNodeData.score || -Infinity;

                    console.log('State loaded successfully');
                    console.log('Root node state:', rootNode.state);
                    console.log('Best score:', this.bestScore);
                    if (this.bestNode) {
                        console.log('Best node state:', this.bestNode.state);
                    }

                    return true;
                } else {
                    console.warn('Loaded state data is not in the expected format. Starting from initial state.');
                    return false;
                }
            } catch (error) {
                console.error('Error parsing saved state:', error);
                console.warn('Starting from initial state due to parsing error.');
                return false;
            }
        } else {
            console.log('No saved state found. Starting from initial state.');
            return false;
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

const {spawn} = require('child_process');


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
                    initialState.code = {
                        "docker-compose.yml": "version: \"3\"\nservices:\n  client:\n    build: ./client\n    ports:\n      - \"3000:3000\"\n  server:\n    build: ./server\n    ports:\n      - \"5000:5000\"\n    environment:\n      - MONGODB_URI=mongodb://mongo:27017/mydatabase\n  mongo:\n    image: mongo:latest\n    ports:\n      - \"27017:27017\"\n    volumes:\n      - mongodb_data:/data/db\n\nvolumes:\n  mongodb_data: {}",

                        "client/package.json": "{\n  \"name\": \"mern-docker-client\",\n  \"version\": \"0.1.0\",\n  \"private\": true,\n  \"dependencies\": {\n    \"react\": \"^18.2.0\",\n    \"react-dom\": \"^18.2.0\",\n    \"react-router-dom\": \"^5.2.0\",\n    \"axios\": \"^0.21.1\",\n    \"lucide-react\": \"^0.263.1\"\n  },\n  \"devDependencies\": {\n    \"@babel/core\": \"^7.22.5\",\n    \"@babel/preset-env\": \"^7.22.5\",\n    \"@babel/preset-react\": \"^7.22.5\",\n    \"babel-loader\": \"^9.1.2\",\n    \"css-loader\": \"^6.8.1\",\n    \"postcss\": \"^8.4.24\",\n    \"postcss-loader\": \"^7.3.3\",\n    \"style-loader\": \"^3.3.3\",\n    \"tailwindcss\": \"^3.3.2\",\n    \"autoprefixer\": \"^10.4.14\",\n    \"html-webpack-plugin\": \"^5.5.3\",\n    \"webpack\": \"^5.88.0\",\n    \"webpack-cli\": \"^5.1.4\",\n    \"webpack-dev-server\": \"^4.15.1\"\n  },\n  \"scripts\": {\n    \"start\": \"webpack serve --mode development\",\n    \"build\": \"webpack --mode production\"\n  }\n}",

                        "client/webpack.config.js": "const path = require('path');\nconst HtmlWebpackPlugin = require('html-webpack-plugin');\n\nmodule.exports = {\n  entry: './src/index.js',\n  output: {\n    path: path.resolve(__dirname, 'build'),\n    filename: 'bundle.js',\n  },\n  module: {\n    rules: [\n      {\n        test: /\\.js$/,\n        exclude: /node_modules/,\n        use: {\n          loader: 'babel-loader',\n          options: {\n            presets: ['@babel/preset-env', '@babel/preset-react'],\n          },\n        },\n      },\n      {\n        test: /\\.css$/,\n        use: ['style-loader', 'css-loader', 'postcss-loader'],\n      },\n    ],\n  },\n  plugins: [\n    new HtmlWebpackPlugin({\n      template: './public/index.html',\n    }),\n  ],\n  devServer: {\n    static: {\n      directory: path.join(__dirname, 'public'),\n    },\n    port: 3000,\n    historyApiFallback: true,\n  },\n};",

                        "client/tailwind.config.js": "module.exports = {\n  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}",

                        "client/src/index.js": "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\n\nconst root = ReactDOM.createRoot(document.getElementById('root'));\nroot.render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);",

                        "client/src/App.js": "import React from 'react';\nimport { BrowserRouter as Router, Route, Switch } from 'react-router-dom';\nimport Navbar from './components/Navbar';\nimport Home from './pages/Home';\nimport Login from './pages/Login';\nimport Register from './pages/Register';\n\nfunction App() {\n  return (\n    <Router>\n      <div className=\"min-h-screen bg-gray-100\">\n        <Navbar />\n        <main className=\"container mx-auto mt-4 p-4\">\n          <Switch>\n            <Route exact path=\"/\" component={Home} />\n            <Route path=\"/login\" component={Login} />\n            <Route path=\"/register\" component={Register} />\n          </Switch>\n        </main>\n      </div>\n    </Router>\n  );\n}\n\nexport default App;",

                        "client/src/styles.css": "@import 'tailwindcss/base';\n@import 'tailwindcss/components';\n@import 'tailwindcss/utilities';\n\n/* You can add any additional custom styles here */",

                        "client/public/index.html": "<!DOCTYPE html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <title>MERN Docker Project</title>\n  </head>\n  <body>\n    <div id=\"root\"></div>\n  </body>\n</html>",

                        "client/Dockerfile": "FROM node:18\n\nWORKDIR /app\n\nCOPY package*.json ./\n\nRUN npm install\n\nCOPY . .\n\nRUN npm run build\n\nEXPOSE 3000\n\nCMD [\"npm\", \"start\"]",

                        "client/src/components/Navbar.js": "import React from 'react';\nimport { Link } from 'react-router-dom';\n\nconst Navbar = () => {\n  return (\n    <nav className=\"bg-white shadow\">\n      <div className=\"container mx-auto px-6 py-3\">\n        <div className=\"flex justify-between items-center\">\n          <div className=\"text-xl font-semibold text-gray-700\">MERN App</div>\n          <div className=\"flex space-x-4\">\n            <Link to=\"/\" className=\"text-gray-700 hover:text-blue-500\">Home</Link>\n            <Link to=\"/login\" className=\"text-gray-700 hover:text-blue-500\">Login</Link>\n            <Link to=\"/register\" className=\"text-gray-700 hover:text-blue-500\">Register</Link>\n          </div>\n        </div>\n      </div>\n    </nav>\n  );\n};\n\nexport default Navbar;",

                        "client/src/pages/Home.js": "import React, { useState } from 'react';\nimport { Card, CardContent } from '../components/ui/card';\nimport { SearchIcon, ChevronRightIcon, PlusIcon, CalendarIcon } from 'lucide-react';\n\nconst Home = () => {\n  const [recentPages, setRecentPages] = useState([\n    { id: 1, title: 'Marketing Plan', updatedAt: '2023-06-15' },\n    { id: 2, title: 'Product Roadmap', updatedAt: '2023-06-30' },\n    { id: 3, title: 'Monthly Report', updatedAt: '2023-07-01' },\n  ]);\n\n  const [upcomingEvents, setUpcomingEvents] = useState([\n    { id: 1, title: 'Weekly Team Meeting', date: '2023-07-07' },\n    { id: 2, title: 'Product Launch Planning', date: '2023-07-15' },\n  ]);\n\n  return (\n    <div className=\"p-10 bg-white text-gray-800\">\n      <h1 className=\"text-4xl font-bold mb-10\">Welcome to MERN App</h1>\n      \n      {/* Search */}\n      <div className=\"bg-gray-100 rounded-lg px-4 py-2 flex items-center mb-8\">\n        <SearchIcon className=\"text-gray-600 mr-2\" />\n        <input type=\"text\" placeholder=\"Search pages and more\" className=\"bg-transparent flex-1 focus:outline-none\" />\n      </div>\n\n      {/* Recent Pages */}\n      <div className=\"mb-12\">\n        <h2 className=\"text-2xl font-bold mb-4\">Recent Pages</h2>\n        <div className=\"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4\">\n          {recentPages.map((page) => (\n            <Card key={page.id} className=\"bg-gray-100 hover:bg-gray-200 transition-colors duration-300 flex justify-between items-center px-4 py-3\">\n              <div>\n                <h3 className=\"text-xl font-bold\">{page.title}</h3>\n                <p className=\"text-gray-600\">Updated {page.updatedAt}</p>\n              </div>\n              <ChevronRightIcon className=\"text-gray-600\" />\n            </Card>\n          ))}\n        </div>\n      </div>\n\n      {/* Upcoming Events */}\n      <div>\n        <h2 className=\"text-2xl font-bold mb-4\">Upcoming Events</h2>\n        <div className=\"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4\">\n          {upcomingEvents.map((event) => (\n            <Card key={event.id} className=\"bg-gray-100 hover:bg-gray-200 transition-colors duration-300 flex items-center px-4 py-3\">\n              <div className=\"bg-blue-500 rounded-full w-10 h-10 flex items-center justify-center mr-4\">\n                <CalendarIcon className=\"text-white\" />\n              </div>\n              <div>\n                <h3 className=\"text-xl font-bold\">{event.title}</h3>\n                <p className=\"text-gray-600\">{event.date}</p>\n              </div>\n            </Card>\n          ))}\n        </div>\n      </div>\n\n      {/* Create New */}\n      <div className=\"mt-12 flex justify-center\">\n        <button className=\"bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg flex items-center\">\n          <PlusIcon className=\"mr-2\" />\n          Create New\n        </button>\n      </div>\n    </div>\n  );\n};\n\nexport default Home;",

                        "client/src/components/ui/card.js": "import React from 'react';\n\nexport const Card = ({ children, className, ...props }) => {\n  return (\n    <div className={`bg-white shadow-md rounded-lg ${className}`} {...props}>\n      {children}\n    </div>\n  );\n};\n\nexport const CardContent = ({ children, className, ...props }) => {\n  return (\n    <div className={`p-4 ${className}`} {...props}>\n      {children}\n    </div>\n  );\n};",

                        "client/src/pages/Login.js": "import React, { useState } from 'react';\n\nconst Login = () => {\n  const [email, setEmail] = useState('');\n  const [password, setPassword] = useState('');\n\n  const handleSubmit = (e) => {\n    e.preventDefault();\n    // Implement login logic here\n  };\n\n  return (\n    <div className=\"max-w-md mx-auto\">\n      <h2 className=\"text-2xl font-bold mb-4\">Login</h2>\n      <form onSubmit={handleSubmit} className=\"space-y-4\">\n        <div>\n          <label htmlFor=\"email\" className=\"block mb-1\">Email</label>\n          <input\n            id=\"email\"\n            type=\"email\"\n            value={email}\n            onChange={(e) => setEmail(e.target.value)}\n            className=\"w-full px-3 py-2 border rounded-md\"\n            required\n          />\n        </div>\n        <div>\n          <label htmlFor=\"password\" className=\"block mb-1\">Password</label>\n          <input\n            id=\"password\"\n            type=\"password\"\n            value={password}\n            onChange={(e) => setPassword(e.target.value)}\n            className=\"w-full px-3 py-2 border rounded-md\"\n            required\n          />\n        </div>\n        <button type=\"submit\" className=\"w-full bg-blue-500 text-white py-2 rounded-md hover:bg-blue-600\">\n          Login\n        </button>\n      </form>\n    </div>\n  );\n};\n\nexport default Login;",

                        "client/src/pages/Register.js": "import React, { useState } from 'react';\n\nconst Register = () => {\n  const [username, setUsername] = useState('');\n  const [email, setEmail] = useState('');\n  const [password, setPassword] = useState('');\n\n  const handleSubmit = (e) => {\n    e.preventDefault();\n    // Implement registration logic here\n  };\n\n  return (\n    <div className=\"max-w-md mx-auto\">\n      <h2 className=\"text-2xl font-bold mb-4\">Register</h2>\n      <form onSubmit={handleSubmit} className=\"space-y-4\">\n        <div>\n          <label htmlFor=\"username\" className=\"block mb-1\">Username</label>\n          <input\n            id=\"username\"\n            type=\"text\"\n            value={username}\n            onChange={(e) => setUsername(e.target.value)}\n            className=\"w-full px-3 py-2 border rounded-md\"\n            required\n          />\n        </div>\n        <div>\n          <label htmlFor=\"email\" className=\"block mb-1\">Email</label>\n          <input\n            id=\"email\"\n            type=\"email\"\n            value={email}\n            onChange={(e) => setEmail(e.target.value)}\n            className=\"w-full px-3 py-2 border rounded-md\"\n            required\n          />\n        </div>\n        <div>\n          <label htmlFor=\"password\" className=\"block mb-1\">Password</label>\n          <input\n            id=\"password\"\n            type=\"password\"\n            value={password}\n            onChange={(e) => setPassword(e.target.value)}\n            className=\"w-full px-3 py-2 border rounded-md\"\n            required\n          />\n        </div>\n        <button type=\"submit\" className=\"w-full bg-blue-500 text-white py-2 rounded-md hover:bg-blue-600\">\n          Register\n        </button>\n      </form>\n    </div>\n  );\n};\n\nexport default Register;",

                        "server/package.json": "{\n  \"name\": \"mern-docker-server\",\n  \"version\": \"1.0.0\",\n  \"description\": \"Express server for MERN Docker project\",\n  \"main\": \"server.js\",\n  \"scripts\": {\n    \"start\": \"node server.js\",\n    \"dev\": \"nodemon server.js\"\n  },\n  \"dependencies\": {\n    \"bcryptjs\": \"^2.4.3\",\n    \"cors\": \"^2.8.5\",\n    \"dotenv\": \"^10.0.0\",\n    \"express\": \"^4.17.1\",\n    \"jsonwebtoken\": \"^8.5.1\",\n    \"mongoose\": \"^5.12.3\"\n  },\n  \"devDependencies\": {\n    \"nodemon\": \"^2.0.7\"\n  }\n}",

                        "server/server.js": "const express = require('express');\nconst mongoose = require('mongoose');\nconst cors = require('cors');\nconst dotenv = require('dotenv');\nconst connectDB = require('./config/database');\nconst apiRoutes = require('./routes/api');\n\ndotenv.config();\n\nconst app = express();\nconst PORT = process.env.PORT || 5000;\n\n// Middleware\napp.use(cors());\napp.use(express.json());\n\n// Connect to MongoDB\nconnectDB();\n\n// Routes\napp.use('/api', apiRoutes);\n\napp.get('/', (req, res) => {\n  res.send('Hello from MERN Docker server!');\n});\n\napp.listen(PORT, () => {\n  console.log(`Server running on port ${PORT}`);\n});",

                        "server/Dockerfile": "FROM node:18\n\nWORKDIR /app\n\nCOPY package*.json ./\n\nRUN npm install\n\nCOPY . .\n\nEXPOSE 5000\n\nCMD [\"node\", \"server.js\"]",

                        "server/config/database.js": "const mongoose = require('mongoose');\n\nconst connectDB = async () => {\n  try {\n    await mongoose.connect(process.env.MONGODB_URI, {\n      useNewUrlParser: true,\n      useUnifiedTopology: true,\n      useCreateIndex: true,\n    });\n    console.log('MongoDB connected successfully');\n  } catch (error) {\n    console.error('MongoDB connection error:', error);\n    process.exit(1);\n  }\n};\n\nmodule.exports = connectDB;",

                        "server/models/User.js": "const mongoose = require('mongoose');\nconst bcrypt = require('bcryptjs');\n\nconst UserSchema = new mongoose.Schema({\n  username: { type: String, required: true, unique: true },\n  email: { type: String, required: true, unique: true },\n  password: { type: String, required: true },\n  createdAt: { type: Date, default: Date.now }\n});\n\nUserSchema.pre('save', async function(next) {\n  if (!this.isModified('password')) return next();\n  this.password = await bcrypt.hash(this.password, 10);\n  next();\n});\n\nmodule.exports = mongoose.model('User', UserSchema);",

                        "server/routes/api.js": "const express = require('express');\nconst router = express.Router();\nconst User = require('../models/User');\nconst bcrypt = require('bcryptjs');\nconst jwt = require('jsonwebtoken');\n\nrouter.post('/register', async (req, res) => {\n  try {\n    const { username, email, password } = req.body;\n    const user = new User({ username, email, password });\n    await user.save();\n    res.status(201).json({ message: 'User registered successfully' });\n  } catch (error) {\n    res.status(400).json({ error: error.message });\n  }\n});\n\nrouter.post('/login', async (req, res) => {\n  try {\n    const { email, password } = req.body;\n    const user = await User.findOne({ email });\n    if (!user) {\n      return res.status(400).json({ message: 'Invalid credentials' });\n    }\n    const isMatch = await bcrypt.compare(password, user.password);\n    if (!isMatch) {\n      return res.status(400).json({ message: 'Invalid credentials' });\n    }\n    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });\n    res.json({ token });\n  } catch (error) {\n    res.status(500).json({ error: error.message });\n  }\n});\n\nmodule.exports = router;",

                        "server/middleware/auth.js": "const jwt = require('jsonwebtoken');\n\nmodule.exports = (req, res, next) => {\n  const token = req.header('x-auth-token');\n  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });\n\n  try {\n    const decoded = jwt.verify(token, process.env.JWT_SECRET);\n    req.user = decoded.user;\n    next();\n  } catch (err) {\n    res.status(401).json({ message: 'Token is not valid' });\n  }\n};",

                        ".gitignore": "node_modules\n.env\nbuild\ndist\n.DS_Store",

                        ".env.example": "MONGODB_URI=mongodb://mongo:27017/mydatabase\nJWT_SECRET=your_jwt_secret_here\nNODE_ENV=development"
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
            if (!finalState) {
                throw new Error('MCTS search failed to produce a valid final state');
            }

            finalState = await performFinalReview(finalState, anthropic, io);


            console.log('Saving generated code to files...');
            io.emit('phase_update', {phase: 'Saving generated code to files...'});

            saveCodeToFile(finalState.code, projectDir);
            console.log('Code saved successfully.');

            // console.log('Starting build process...');
            // io.emit('phase_update', { phase: 'Starting build process...' });
            // let buildSuccess = false;
            // let buildAttempts = 0;
            //
            // while (!buildSuccess && buildAttempts < MAX_BUILD_ATTEMPTS) {
            //     buildAttempts++;
            //     console.log(`Build attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS}`);
            //     io.emit('phase_update', {phase: `Build attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS}`});
            //
            //     buildSuccess = await runDockerBuildTest(projectDir, io, anthropic);
            //
            //     if (!buildSuccess) {
            //         console.log('Build failed. Retrying...');
            //         io.emit('phase_update', {phase: 'Build failed. Retrying...'});
            //     }
            // }


            io.emit('phase_update', {phase: `Project Build Complete. Creating ZIP file for project`});
            console.log('Creating ZIP file for project');
            const outputDirPath = path.join('output', projectId);

            const zipPath = path.join(outputDirPath, 'project.zip');
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', {zlib: {level: 9}});

            output.on('close', async () => {
                console.log('ZIP file created successfully');
                const fileStream = fs.createReadStream(zipPath);

                try {
                    const url = await uploadProjectToS3(projectId, io, fileStream);
                    io.emit('project_generated', {projectId, url});
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

async function performFinalReview(state, llm, io) {
    const reviewPrompt = `
    Final project state:
    ${JSON.stringify(state, null, 2)}

    Perform a comprehensive review of the entire full-stack project. Suggest final optimizations and improvements to ensure:
    1. Proper integration between all components (frontend, backend, database)
    2. Consistent coding style and best practices across the project
    3. Scalability and maintainability of the codebase
    4. Security considerations for both frontend and backend
    5. Optimization of database queries and API endpoints
    6. Completeness of features based on the original problem statement

    Provide your suggestions as a series of specific code updates.

    Use the following format for your response:
    <thinking>
    [Your comprehensive analysis of the project and reasoning about final improvements]
    </thinking>
    <json>
    {
      "updates": [
        {
          "file": "path/to/file.js",
          "category": "Frontend/Backend/Database/DevOps",
          "description": "Description of the final optimization",
          "code": "Updated code content"
        },
        ...
      ]
    }
    </json>
  `;

    try {
        const response = await llm.messages.create({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 4096,
            messages: [{role: 'user', content: reviewPrompt}],
        });

        const responseText = extractResponseText(response);
        const updatesJson = extractJsonFromText(responseText);

        let updates = [];
        try {
            const parsedUpdates = JSON.parse(updatesJson);
            if (parsedUpdates && Array.isArray(parsedUpdates.updates)) {
                updates = parsedUpdates.updates;
            } else {
                console.warn("Parsed updates is not in the expected format. Using empty array.");
            }
        } catch (parseError) {
            console.error("Error parsing updates JSON:", parseError);
            io.emit('phase_update', { phase: `Error parsing final review updates. Skipping final optimizations.` });
            return state;
        }

        if (updates.length === 0) {
            console.warn("No updates suggested in the final review.");
            io.emit('phase_update', { phase: `No updates suggested in the final review.` });
            return state;
        }

        for (const update of updates) {
            if (update.file && update.code) {
                state.code[update.file] = update.code;
                console.log(`Updated file in final review: ${update.file}`);
            } else {
                console.warn(`Skipping invalid update in final review:`, update);
            }
        }

        io.emit('phase_update', { phase: `Performed final review and applied ${updates.length} optimization(s)` });
        return state;
    } catch (error) {
        console.error('Error in performFinalReview:', error);
        io.emit('phase_update', { phase: `Error during final review: ${error.message}` });
        return state;
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
        ACL: 'public-read', // Make the object publicly readable
    };

    try {
        // Upload the project ZIP file to DigitalOcean Spaces
        await s3.upload(uploadParams).promise();
        console.log('Project ZIP file uploaded to S3');

        // Generate a pre-signed URL for the object
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
        io.emit('project_generated', {projectId, error: error.message});
        throw error; // Re-throw the error to be handled by the caller
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
