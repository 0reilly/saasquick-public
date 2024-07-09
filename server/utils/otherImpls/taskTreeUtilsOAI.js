const archiver = require('archiver');
const {openai} = require("../config");
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
        const actions = await this.getAvailableActions(llm, io);
        for (const action of actions) {
            const newState = await this.applyAction(action, llm, io);
            const newNode = new Node(newState, this);
            this.children.push(newNode);
        }
    }

    async simulate(llm, io) {
        let state = this.state;
        while (!isTerminalState(state)) {
            const actions = await this.getAvailableActions(llm, io);
            const randomAction = actions[Math.floor(Math.random() * actions.length)];
            state = await this.applyAction(randomAction, llm, io);
        }
        return await this.evaluateState(state, llm, io);
    }

    async evaluateState(state, llm, io) {
        try {
            const evaluationPrompt = `
Problem Statement: ${state.problemStatement}
Project Type: ${state.projectType}
Code Structure:
${JSON.stringify(state.codeStructure, null, 2)}
Generated Code:
${state.code}

Evaluate the quality, performance, maintainability, and feasibility of the generated code considering the following criteria:
- Alignment with the problem statement and project requirements
- Code structure and organization
- Best practices and coding standards
- Functionality and correctness
- Testability and presence of unit tests
- Integration with required libraries and APIs (e.g., Stripe)
- User experience and responsiveness of the UI

Provide a float score between 0.0 and 1.0, where 1.0 represents the best solution 
Provide your thinking step - by - step with <thinking> tags.
Response format:
<float>
0.8
</float>
Consider all the mentioned criteria when determining the score.
Do not include any additional information or text in the response.
`;

            const evaluationResponse = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant designed to output a score.",
                    },
                    {role: "user", content: evaluationPrompt},
                ],
                model: "gpt-4o",
            });


            console.log('Evaluation LLM output:', extractResponseText(evaluationResponse));
            const responseText = extractResponseText(evaluationResponse);
            const floatResponse = extractFloatFromText(responseText);
            const thinkingText = extractThinkingFromText(responseText);
            io.emit('phase_update', {phase: `Thinking: ${thinkingText}`})

            const score = parseFloat(floatResponse);
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
        let maxRetries = 3;
        let retries = 0;

        while (retries < maxRetries) {
            const actionsPrompt = `
Problem Statement: ${this.state.problemStatement}
Project Type: ${this.state.projectType}
Code Structure:
${JSON.stringify(this.state.codeStructure, null, 2)}
Current Code:
${this.state.code || ''}

Generate a list of possible actions or code modifications to improve the current code based on the problem statement, project type, and code structure.
Consider the following aspects:
- Adding new components, pages, or features
- Writing unit tests for components
- Optimizing performance and code structure
- Handling edge cases and error scenarios

Provide a diverse set of actions that cover different aspects of the code generation process.
Think through your response step by step with <thinking> tags.
Respond with a valid JSON array of actions, enclosed in <json> tags.
Response format:
<json>
{
    "actions": [
        "Add a new component for user authentication",
        "Refactor the existing code to improve performance",
        "Write unit tests for the 'App' component"
    ]
}
</json>
Do not include any additional information or text in the response.
`;

            const actionsResponse = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant designed to output JSON.",
                    },
                    {role: "user", content: actionsPrompt},
                ],
                model: "gpt-4o",
            });

            console.log('Available actions LLM output:', extractResponseText(actionsResponse));
            const responseText = extractResponseText(actionsResponse);
            const actionsJson = extractJsonFromText(responseText)
            const thinkingText = extractThinkingFromText(responseText);
            io.emit('phase_update', {phase: `Thinking: ${thinkingText}`})

            try {
                const actions = JSON.parse(actionsJson).actions;
                console.log('Parsed actions:', actions)
                if (Array.isArray(actions)) {
                    return actions;
                } else {
                    throw new Error('Parsed JSON is not an array');
                }
            } catch (error) {
                console.error('Error parsing JSON:', error);
                retries++;
                if (retries === maxRetries) {
                    console.error('Failed to parse JSON response after multiple retries. Returning empty array.');
                    return [];
                }
                console.log(`Retrying... (Attempt ${retries})`);
            }
        }

        return []; // Default return value if all retries fail
    }

    async applyAction(action, llm, io) {
        const maxRetries = 3;
        let retries = 0;

        while (retries < maxRetries) {
            const applyPrompt = `
Problem Statement: ${this.state.problemStatement}
Project Type: ${this.state.projectType}
Code Structure:
${JSON.stringify(this.state.codeStructure, null, 2)}
Current Code:
${JSON.stringify(this.state.code || {}, null, 2)}
Action to Apply:
${JSON.stringify(action, null, 2)}

Apply the given action or code modification to the current code while considering the problem statement, project type, and code structure.
Generate the updated code for each file specified in the code structure.
Think through your solution logically step-by-step with <thinking></thinking> tags.
Provide the updated code in a valid JSON format, enclosed in <json> tags. It will be parsed and paid for so please make sure it is valid JSON.
Use the following format for the JSON response object:
<json>
{
  "code": {
    "path/to/file1.js": "Updated code content for file1 \\nwith multiple lines",
    "path/to/file2.js": "Updated code content for file2 \\nwith multiple lines"
  }
}
</json>
Make sure to:
- Escape any special characters (e.g., newline characters) in the code snippets to ensure they are valid within the JSON string.
- Double-check the generated JSON for any syntax errors or missing closing brackets/braces.
- Provide the complete code content for each file, even if the action only modifies a specific part of the file.

Do not include any additional information or text in the response.
`;

            const applyResponse = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant designed to output JSON.",
                    },
                    {role: "user", content: applyPrompt},
                ],
                model: "gpt-4o",
            });

            console.log('Apply action LLM output:', extractResponseText(applyResponse));
            const responseText = extractResponseText(applyResponse);
            const updatedCodeJson = extractJsonFromText(responseText);
            const thinkingText = extractThinkingFromText(responseText);

            io.emit('phase_update', {phase: `Thinking: ${thinkingText}`});

            try {
                const parsedResponse = JSON.parse(updatedCodeJson);
                return {...this.state, code: {...this.state.code, ...parsedResponse.code}};

            } catch (error) {
                console.error('Error parsing JSON:', error);
                retries++;
                if (retries === maxRetries) {
                    return {...this.state, error: 'Failed to parse JSON response from LLM after multiple retries'};
                }
                console.log(`Retrying... (Attempt ${retries})`);
            }
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
    constructor(explorationFactor = 1.4) {
        this.explorationFactor = explorationFactor;
        this.bestNode = null;
        this.bestScore = -Infinity;
    }

    async search(initialState, numIterations, llm, io) {
        const rootNode = new Node(initialState);

        for (let i = 0; i < numIterations; i++) {
            io.emit('phase_update', {phase: `Iteration ${i + 1} of ${numIterations}`})
            console.log(`Iteration ${i + 1}:`);
            let node = rootNode;

            // Selection
            while (node.children.length > 0) {
                node = node.getBestChild(this.explorationFactor);
                console.log(`Selected node: ${JSON.stringify(node.state)}`);
                console.log(`UCB score: ${node.getUCBScore(this.explorationFactor)}`);
            }

            // Expansion
            await node.expand(llm, io);
            console.log(`Expanded node: ${JSON.stringify(node.state)}`);
            console.log(`Number of children: ${node.children.length}`);

            // Simulation
            const score = await node.simulate(llm, io);
            console.log(`Simulation score: ${score}`);


            // Backpropagation
            node.backpropagate(score);
            console.log(`Backpropagated score: ${score}`);

            if (score > this.bestScore) {
                this.bestScore = score;
                this.bestNode = node;
            }
        }

        return this.bestNode.state;
    }

}


function isTerminalState(state) {
    return state.code !== undefined;
}

async function solveProblem(problemStatement, projectType, io, projectId) {
    console.log(`Received problem statement: "${problemStatement}"`);
    console.log(`Project type: "${projectType}"`);
    console.log(`Project ID: "${projectId}"`);
    try {
        console.log('Analyzing problem statement using LLM...');
        let retryAdditional = true;
        let additionalInfo = {};
        while (retryAdditional) {
            const additionalInfoPrompt = `
Problem Statement: ${problemStatement}

Analyze the given problem statement and extract additional information required for generating the code structure and initial state.
Consider the following aspects:
- Project type and architecture
- Key features and requirements
- Technology stack and dependencies
- Code organization and structure

Provide the additional information in a valid JSON format, enclosed in <json> tags.
Do not include any additional information or text in the response.

`;

            const additionalInfoResponse = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant designed to output JSON.",
                    },
                    {role: "user", content: additionalInfoPrompt},
                ],
                model: "gpt-4o",
            });

            console.log('Additional info LLM output:', extractResponseText(additionalInfoResponse));
            const additionalInfoText = extractResponseText(additionalInfoResponse);
            const additionalInfoJson = extractJsonFromText(additionalInfoText);
            try {
                additionalInfo = JSON.parse(additionalInfoJson);
            } catch (error) {
                console.error('Error parsing additional info JSON:', error);
            }

            retryAdditional = false;
        }

        console.log('Problem statement analyzed successfully.');

        console.log('Generating initial state using LLM...');
        let initialState = {
        };

        let retry = true;
        while (retry) {
            const initialStatePrompt = `
Problem Statement: ${problemStatement}
Project Type: ${projectType}
Additional Information:
${JSON.stringify(additionalInfo, null, 2)}

Generate the initial state for the given problem statement, project type, and additional information.
The initial state should include:
- Problem statement
- Project type
- Code structure with placeholders for key components and files
- Dependencies for the project

Provide the initial state in a valid JSON format, enclosed in <json> tags.
Example format:
<json>
{
    "problemStatement": "Your problem statement here",
    "projectType": "Your project type here",
    "codeStructure": {
        "src": {
            "index.js": "Your code here",
            "components": {
                "App.js": "Your code here",
                "Header.js": "Your code here"
            }
        },
        "package.json": "Your dependencies here"
    },
    "code": ""
}
            
Do not include any additional information or text in the response.

`

            const initialStateResponse = await openai.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant designed to output JSON.",
                    },
                    {role: "user", content: initialStatePrompt},
                ],
                model: "gpt-4o",
            });

            console.log('Initial state LLM output:', extractResponseText(initialStateResponse));
            const initialStateText = extractResponseText(initialStateResponse);
            const initialStateJson = extractJsonFromText(initialStateText);
            try {
                initialState = JSON.parse(initialStateJson);
            } catch (error) {
                console.error('Error parsing initial state JSON:', error);
                // Handle the error or retry the LLM request
            }
            retry = false;

        }
        console.log('Initial state generated successfully.');

        console.log('Creating project directory...');
        const projectDir = path.join('output', projectId);
        fs.mkdirSync(projectDir, {recursive: true});
        console.log('Starting code generation using MCTS...');
        try {
            const mcts = new MCTS(4.0);
            let currentState = initialState;
            let bestState = null;
            let bestScore = -Infinity;

            currentState = await mcts.search(currentState, 1, openai, io);
            console.log('Current state:', JSON.stringify(currentState));

            console.log('Best state:', bestState);
            console.log('Best score:', bestScore);

            io.emit('phase_update', {phase: 'Saving generated code to files...'});
            console.log('Saving generated code to files...');
            console.log('Current state:', currentState);
            const code = currentState.code;

            const saveCodeToFile = (filePath, fileContent) => {
                const fullPath = path.join(projectDir, filePath);
                const dirPath = path.dirname(fullPath);
                fs.mkdirSync(dirPath, {recursive: true});
                fs.writeFileSync(fullPath, fileContent);
            };

            Object.entries(code).forEach(([filePath, fileContent]) => {
                if (fileContent.trim() !== '') {
                    saveCodeToFile(filePath, fileContent);
                }
            });

            console.log('Code saved successfully.');
            io.emit('phase_update', {phase: 'Code saved successfully.'});
        } catch (error) {
            console.error('Error generating code using MCTS:', error);
            // Handle the error appropriately, e.g., retry the code generation process
        }

        console.log('Autonomous software engineer completed the task successfully.');

        return {
            projectId,
        };
    } catch (error) {
        console.error('Error solving problem:', error);
        // Handle the error appropriately, e.g., send an error response
        io.emit('error', {message: 'An error occurred while solving the problem.'});
    }
}


async function initializeGitRepository(projectDir) {
    return new Promise((resolve, reject) => {
        const git = spawn('git', ['init'], {cwd: projectDir});
        git.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Git initialization failed with code ${code}`));
            }
        });
    });
}

async function deployApplication(deploymentConfigs, projectDir) {
    // Placeholder implementation
    console.log('Deploying application...');
    console.log('Deployment configs:', deploymentConfigs);
    console.log('Project directory:', projectDir);
    // Simulating deployment process
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log('Application deployed successfully.');
    return {
        url: 'https://example.com',
        status: 'success',
    };
}

async function setupMonitoringAndLogging(deploymentResult) {
    // Placeholder implementation
    console.log('Setting up monitoring and logging...');
    console.log('Deployment result:', deploymentResult);
    // Simulating monitoring and logging setup process
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('Monitoring and logging set up successfully.');
}

const extractResponseText = (response) => {
    return response.choices[0].message.content;
};

const extractJsonFromText = (text) => {
    const jsonRegex = /<json>(.*?)<\/json>/s;
    const match = text.match(jsonRegex);
    if (match && match[1]) {
        return match[1].trim();
    }
    return '{}';
};

const extractFloatFromText = (text) => {
    const jsonRegex = /<float>(.*?)<\/float>/s;
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
