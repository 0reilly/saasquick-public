const fs = require('fs');
const path = require('path');
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

const MAX_BUILD_ATTEMPTS = 3;

let problemStatement;

const runBuildRevisionLoop = async (formattedTree, taskTree, bestAppState, totalTasks, projectPaths, executedTasks, io, projectId) => {
    let buildAttempts = 1;
    let buildSuccessful = false;
    const outputDirPath = path.join('output', projectId);
    const projectDirPath = path.join('projects', projectId);

    while (!buildSuccessful && buildAttempts < MAX_BUILD_ATTEMPTS) {
        buildAttempts++;
        console.log(`Attempting build (attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS})`);
        io.emit('phase_update', {phase: `Running Docker Build (Attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS}) - `})
        io.emit('progress_update', {progress: calculateProjectCompletion(executedTasks.length, totalTasks)});

        await buildProject(formattedTree, totalTasks, bestAppState, projectPaths, executedTasks, projectId, io);

        const buildResult = await executeBuildCommand(outputDirPath);
        console.log('Build result:', buildResult);
        buildSuccessful = !buildResult.error;

        if (!buildSuccessful) {
            console.log('Build attempt failed. Generating additional tasks...');
            io.emit('phase_update', {phase: `Build attempt failed. Analyzing errors`})
            io.emit('progress_update', {progress: calculateProjectCompletion(executedTasks.length, totalTasks)});

            const errorMessage = buildResult.error.message;
            const buildErrorTasks = await generateBuildErrorTasks(errorMessage, bestAppState, projectId);

            saveTaskTree(buildErrorTasks, projectDirPath, true);
            taskTree = [...taskTree, ...buildErrorTasks];
            let newTotalTasks = await countLeafNodes(taskTree);
            console.log('New total tasks:', newTotalTasks);
            io.emit('phase_update', {phase: `Resolving build errors (Attempt ${buildAttempts}/${MAX_BUILD_ATTEMPTS})`})
            io.emit('progress_update', {progress: calculateProjectCompletion(executedTasks.length, newTotalTasks)});

            // Call traverseTaskTree with the updated task tree and total tasks
            executedTasks = await traverseTaskTree(formattedTree, taskTree, newTotalTasks, bestAppState, executedTasks, projectId, io);
        }
    }

    if (buildSuccessful) {
        console.log('Project built successfully after revisions');
    } else {
        console.error('Failed to build the project after multiple attempts');
    }
};

const buildProject = async (formattedTree, totalTasks, bestAppState, projectPaths, executedTasks, projectId, io) => {
    console.log('inside buildProject')
    const outputDirPath = path.join('output', projectId);
    const projectDirPath = path.join('projects', projectId);
    let taskTree = formattedTree;
    try {
        // Build the project using Docker Compose
        const buildResult = await executeBuildCommand(outputDirPath);

        if (buildResult.error) {
            // Build error occurred
            const errorMessage = buildResult.error.message;

            // Generate additional tasks to resolve the build error
            const buildErrorTasks = await generateBuildErrorTasks(errorMessage, bestAppState, projectId);

            // Append the new tasks to the existing task tree
            await saveTaskTree(buildErrorTasks, projectDirPath, true);
            taskTree = [...taskTree, ...buildErrorTasks];
            let newTotalTasks = await countLeafNodes(taskTree);
            io.emit('phase_update', {phase: `Resolving build errors`})
            io.emit('progress_update', {progress: calculateProjectCompletion(executedTasks.length, newTotalTasks)});
            // Execute the new tasks
            await traverseTaskTree(formattedTree, buildErrorTasks, newTotalTasks, bestAppState, executedTasks, projectId, io);
        } else {
            // Build successful
            console.log('Project built successfully');
        }
    } catch (error) {
        console.error('Error while building the project:', error);
    }
};

const executeBuildCommand = async (outputDirPath) => {
    // Run the build command using Docker Compose to build the project
    console.log('inside executeBuildCommand')
    const buildCommand = `docker-compose -f ${path.join(outputDirPath, 'docker-compose.yml')} up --build -d`;

    return new Promise((resolve, reject) => {
        //print the build command stream
        exec(buildCommand, (error, stdout, stderr) => {
            if (error) {
                console.error('Build error:', error);
                console.error('Build stderr:', stderr);
                resolve({error: {message: stderr}});
            } else {
                console.log('Build stdout:', stdout);
                resolve({stdout});
            }
        });
    });
};


const breakDownProblem = async (problemStatement, bestAppState) => {
    console.log('Inside breakDownProblem with', problemStatement, JSON.stringify(bestAppState));

    const prompt = `
    Github Project Prompt: ${problemStatement}
    Best App State from MCTS: ${JSON.stringify(bestAppState)}
    
    Use the app state to generate a decimal formatted Hierarchical Task Trie (separated by newline chars) that will create a production ready project with all features working as expected.
    Only include tasks that can be completed by writing a code snippet to a file.
    Each task should contain the task number, goal behavior description, and the single file path where the code snippet should be written. DO NOT add more than one file path per task.
    The task execution process can only write one file at a time, so each task should be granular and independent from other tasks.
    Each task will be executed using code generation with a large language model.
    Use pnpm as the default for package management. Include package.json in the proper subdirectories.
    Think step by step about all the features implied from the prompt
    
    - Analyze the problem statement to identify key features and requirements
    - Break down the problem into smaller, manageable tasks 
    - Consider the necessary components:
      - pnpm for package management and related config files
      - Backend with API routes, database integration, authentication, error handling, testing, Dockerfile
      - Frontend with reusable components, state management, styling, authentication flows, testing, Dockerfile
      - Docker Compose setup with separate services, networking, volumes, health checks
      - CI/CD pipeline with automated builds, tests, multi-stage deployments, containerization
      - Code quality tools, security analysis, documentation
    - Determine the specific technologies and frameworks to use based on the requirements
    - Plan out the folder structure and organization of files
    - Create tasks for each granular step, ensuring they can be executed independently
    
    Do not include any explanations or additional text outside the <thinking> tags and the <tree> tags.
    Make sure there is only one file name with full path per task.
    Example of a task tree:
    <thinking>
    Think about the problem step-by-step
    </thinking>
    <tree>
    1. Project Section 1 
    1.1. Parent Task 1 
    1.1.1. Child Task 1.1 (/path/to/file.js)
    1.1.2. Child Task 1.2 (/path/to/file.js)
    1.1.3 Child Task 1.3 (/path/to/file.js)
    1.2. Parent Task 2
    1.2.1. Child Task 2.1 (/path/to/file.js)
    1.2.2. Child Task 2.2 (/path/to/file.js)
    1.2.3. Child Task 2.3 (/path/to/file.js)
    2. Project Section 2
    2.1. Parent Task 1
    ...
    </tree>
    `;

    const responses = [];
    for (let i = 0; i < 5; i++) {
        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 4096,
            messages: [{role: 'user', content: prompt}],
        });

        console.log(`Response ${i + 1}:`, extractResponseText(response));
        responses.push(extractResponseText(response));
    }

    const votingPrompt = `Given the following 5 task tree responses, vote on the one with the best chances of leading to a production-ready web application after executing the tasks. Make sure there is only one file name with full path per task. Provide your reasoning.

  ${responses.map((response, index) => `Response ${index + 1}:\n${response}`).join('\n\n')}`;

    const votingResponse = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4096,
        messages: [{role: 'user', content: votingPrompt}],
    });

    const votingResult = extractResponseText(votingResponse);
    console.log('Voting result:', votingResult);

// Extract the selected response index from the voting result
    const selectedIndexMatch = votingResult.match(/Response (\d+)/);
    const selectedIndex = selectedIndexMatch ? parseInt(selectedIndexMatch[1]) - 1 : 0;
    const selectedResponse = responses[selectedIndex];

    try {
        const thinkingMatch = selectedResponse.match(/<thinking>(.*?)<\/thinking>/s);
        const thinking = thinkingMatch ? thinkingMatch[1].trim() : '';
        console.log('Thinking:', thinking);

        const treeMatch = selectedResponse.match(/<tree>(.*?)<\/tree>/s);
        const taskTree = treeMatch ? treeMatch[1].trim() : '';
        console.log('Task Tree:', taskTree);

        return {thinking, taskTree};
    } catch (error) {
        console.error('Error in breakDownProblem:', error);
        return {thinking: '', taskTree: ''};
    }
};

const saveCompletedTasks = (executedTasks, projectDirPath) => {
    console.log('saving completed tasks', executedTasks)
    const filename = `completedTasks.txt`;
    const filePath = path.join(projectDirPath, filename);

    if (!fs.existsSync(projectDirPath)) {
        fs.mkdirSync(projectDirPath, {recursive: true});
    }

    // Remove any empty strings from the executedTasks array
    const filteredTasks = executedTasks.filter(task => task.trim() !== '');

    // Convert the filteredTasks array to a string with each task on a new line
    const tasksString = filteredTasks.join('\n');

    //save array of tasks to file
    fs.writeFileSync(filePath, tasksString);
};

const saveTaskTree = async (taskTree, projectId) => {
    try {
        const projectDirPath = path.join(__dirname, 'projects', projectId);
        const taskTreeFilePath = path.join(projectDirPath, 'taskTree.json');

        // Create the project directory if it doesn't exist
        if (!fs.existsSync(projectDirPath)) {
            fs.mkdirSync(projectDirPath, {recursive: true});
        }

        // Save the task tree to a file
        fs.writeFileSync(taskTreeFilePath, JSON.stringify(taskTree, null, 2));

        console.log('Task tree saved successfully');
    } catch (error) {
        console.error('Error saving task tree:', error);
        throw error;
    }
};

const loadCompletedTasks = (projectDirPath) => {
    const filename = `completedTasks.txt`;
    const filePath = path.join(projectDirPath, filename);

    if (fs.existsSync(filePath)) {
        const tasks = fs.readFileSync(filePath, 'utf8');
        //return array of tasks
        return tasks.split('\n');
    } else {
        return [];
    }
}

const loadTaskTree = (projectDirPath) => {
    const filename = `task_tree.txt`;
    const filePath = path.join(projectDirPath, filename);

    if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
    } else {
        return '';
    }
}

const traverseTaskTree = async (formattedTree, taskTree, totalTasks, bestAppState, executedTasks, projectId, io) => {
    const outputDirPath = path.join('output', projectId);
    const projectDirPath = path.join('projects', projectId);

    console.log('executedTasks:', executedTasks);
    for (const task of taskTree) {
        if (task && task.task && !executedTasks.includes(task.task)) {
            const isLeafNode = !task.children || task.children.length === 0;
            if (isLeafNode) {
                io.emit('phase_update', {phase: `Executing Task: ${task.task}`})

                const taskResult = await executeTask(bestAppState, task);
                console.log('Task result:', taskResult);
                const codeBlocks = extractCodeBlocks(taskResult);
                console.log('Code blocks:', codeBlocks);
                for (const {filename, codeBlock} of codeBlocks) {
                    if (codeBlock && filename) {
                        console.log(`filename: ${filename}`)
                        const filePath = path.join(outputDirPath, filename);
                        const existingContent = await readCodeFromFile(filePath);
                        console.log(`existing content check : ${existingContent}`)
                        if (existingContent) {
                            let updatedContent = await insertCodeBlockWithLLM(existingContent, bestAppState, codeBlock, filename, task, outputDirPath);
                            if (updatedContent) {
                                io.emit('phase_update', {phase: `Inserting code block into file: ${filename}`})
                                await writeCodeToFile(updatedContent, filePath);
                                executedTasks.push(task.task);
                                saveCompletedTasks(executedTasks, projectDirPath);
                            } else {
                                console.warn(`Failed to update content for file: ${filePath}`);
                                //taskCompleted = false;
                            }
                        } else {
                            io.emit('phase_update', {phase: `Writing code block to file: ${filename}`})
                            await writeCodeToFile(codeBlock, filePath);
                            executedTasks.push(task.task);
                            saveCompletedTasks(executedTasks, projectDirPath);
                        }


                    } else {
                        console.warn(`Skipping code block due to missing filename or code block.`);
                        //taskCompleted = false;
                    }
                }

                // if (taskCompleted) {
                //     executedTasks.push(task.task);
                //     await saveCompletedTasks(executedTasks, problemStatement);
                // } else {
                //     const isTaskComplete = await evaluateTask(fileStructure, problemStatement, taskResult, task);
                //
                //     if (!isTaskComplete && taskResult !== 'No code blocks found in the task result.') {
                //         const refinedTaskResult = await refineTask(taskResult, problemStatement, task, outputDirPath);
                //
                //         if (refinedTaskResult !== 'No code blocks found in the refined task result.') {
                //             const isRefinedTaskComplete = await evaluateTask(fileStructure, problemStatement, refinedTaskResult, task);
                //
                //             if (isRefinedTaskComplete) {
                //                 executedTasks.push(task.task);
                //                 await saveCompletedTasks(executedTasks, problemStatement);
                //             }
                //         }
                //     } else {
                //
                //     }
                // }

                const progress = calculateProjectCompletion(executedTasks.length, totalTasks);
                io.emit('progress_update', {progress});
            }
        }

        if (task.children && task.children.length > 0) {
            const childFormattedTree = task.children.map(childTask => childTask.task).join('\n');
            await traverseTaskTree(childFormattedTree, task.children, totalTasks, bestAppState, executedTasks, projectId, io);
        }
    }

    return executedTasks;
};

const parseTaskTree = (text) => {
    const lines = text.split('\n');
    const taskTree = [];
    const stack = [taskTree];

    for (const line of lines) {
        if (line.trim() === '') continue;

        const level = (line.match(/\./g) || []).length;
        const task = line.trim();

        while (stack.length > level) {
            stack.pop();
        }

        const currentNode = {task, children: []};
        if (level > 0) {
            stack[stack.length - 1].push(currentNode);
        }

        if (level < 3) {
            stack.push(currentNode.children);
        }
    }

    return taskTree;
};

const extractResponseText = (response) => {
    return response.content[0].text;
};

const updateProjectPaths = (projectPaths, filePath) => {
    const dirPath = path.dirname(filePath);
    if (!projectPaths.has(dirPath)) {
        projectPaths.add(dirPath);
    }
};

const globalContext = []

const executeTask = async (bestAppState, task) => {
    //extract filename and path from task object by detecting the parenthesis
    console.log('executing task with best app state: ', JSON.stringify(bestAppState), JSON.stringify(task));

    let maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {

        const prompt = `
     Please implement the following task with the following info
     Task with full pathname: ${task.task}
     Problem Statement: ${problemStatement}
     Best App State from MCST: ${JSON.stringify(bestAppState)}
     Use pnpm for package management and actively maintained libraries.
     
     Before providing the code block, please think about the task step-by-step within <thinking></thinking> tags. Then, provide the response as a single JSON object with the following structure:
     codeBlock is type String but should have proper indentation and formatting.
     The JSON object will be parse so please make sure to only include valid JSON.
     Here is an example of the JSON response:
     <json>
        {
            "filename": "client/src/components/ExampleComponent.js",
            "codeBlock": "function ExampleComponent() {\\n  return <div>Hello, World!</div>;\\n}\\n\\nexport default ExampleComponent;\\n"
        }
     </json>
     
     Do not include any additional text or explanations outside the <thinking> and <json> tags.
     Make sure to place the output code block in the appropriate folder based on the existing file structure and avoid redundancy.
     `;

        globalContext.push({role: 'user', content: prompt})
        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 4096,
            messages: globalContext,
        });

        const responseText = extractResponseText(response);

        globalContext.push({role: 'assistant', content: responseText})
        console.log('Task execution response:', responseText);

        try {
            const thinkingMatch = responseText.match(/<thinking>(.*?)<\/thinking>/s);
            const thinking = thinkingMatch ? thinkingMatch[1].trim() : '';
            console.log('Thinking:', thinking);

            const jsonMatch = responseText.match(/<json>(.*?)<\/json>/s);
            const jsonResponse = jsonMatch ? jsonMatch[1].trim() : '';

            // Remove newline characters from the JSON response
            const cleanedJsonResponse = jsonResponse.replace(/\n/g, '');

            console.log('JSON Response:', cleanedJsonResponse);

            const parsedResponse = JSON.parse(cleanedJsonResponse);

            // Replace escaped newline characters with actual newline characters in the codeBlock
            //parsedResponse.codeBlock = parsedResponse.codeBlock.replace(/\\n/g, '\n');

            return parsedResponse;

        } catch (error) {
            console.error('Error executing task:', error);
            retries++;
            return null;
        }
    }
};

function extractJsonFromResponse(responseText) {
    // Attempt to parse the response as JSON

    // Remove any trailing commas
    responseText = responseText.replace(/,\s*}/g, '}');

    // Remove any comments
    responseText = responseText.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

    // Attempt to parse the modified JSON
    try {
        return JSON.parse(responseText);
    } catch (error) {
        // JSON parsing failed, return null
        return null;
    }
}

const extractCodeBlocks = (jsonResponse) => {
    if (jsonResponse && jsonResponse.filename && jsonResponse.codeBlock) {
        // Unescape the codeBlock content
        const unescapedCodeBlock = jsonResponse.codeBlock.replace(/\\"/g, '"').replace(/\\n/g, '\n');
        return [{
            filename: jsonResponse.filename,
            codeBlock: unescapedCodeBlock
        }];
    } else {
        return [];
    }
};


const insertCodeBlockWithLLM = async (existingContent, bestAppState, codeBlock, filename, task, outputDirPath) => {
    const cleanFilename = filename.replace(outputDirPath, '');
    console.log(`Inserting code block with LLM for file: ${cleanFilename}`);

    const prompt = `
    Task: ${task}
    Filename: ${cleanFilename}
    Best App State from MCST: ${JSON.stringify(bestAppState)}
    Existing file content:
    ${existingContent}
    Code block to merge:
    ${codeBlock}
    
    Given the existing content of a file and a new code block, determine the appropriate way to merge the code block into the file. If the existing content uses CommonJS module syntax (module.exports) and the new code block uses ES6 module syntax (import/export), or vice versa, refactor the code to use a consistent module syntax throughout the file.

    If the filename is "package.json", ensure that the JSON is properly formatted with each key-value pair on a new line, indented with two spaces, and the entire JSON object is wrapped in proper curly braces.

    Provide only the updated file content with the code block merged in the correct location and with consistent module syntax. Do not include any explanations, additional text, or code block delimiters.
    Make sure to place the code blocks in the appropriate folders based on the existing file structure and avoid redundancy.
    Do not include any additional text or explanations.
    `;

    const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4048,
        messages: [{role: 'user', content: prompt}],
    });

    const updatedContent = extractResponseText(response);
    console.log(`Updated content for file: ${cleanFilename}:\n${updatedContent}`);

    // Remove code block delimiters
    const cleanedContent = updatedContent.replace(/```[a-z]+/g, '').trim();

    return cleanedContent;
};

const readCodeFromFile = async (filename) => {
    (`Reading code from file: ${filename}`);

    if (fs.existsSync(filename)) {
        return fs.readFileSync(filename, 'utf8');
    } else {
        return '';
    }
};


const writeCodeToFile = async (codeBlock, filePath) => {
    //check if code block is an object and wrap with string
    let codeBlockString = codeBlock;
    if (typeof codeBlock === 'object') {
        codeBlockString = JSON.stringify(codeBlock);
    }
    const cleanCodeBlock = codeBlockString.replace(/```[a-z]+/g, '').trim();
    const fileDir = path.dirname(filePath);

    if (fs.existsSync(fileDir)) {
        const stats = await fs.promises.stat(fileDir);
        if (stats.isFile()) {
            await fs.promises.unlink(fileDir);
        }
    }

    if (!fs.existsSync(fileDir)) {
        await fs.promises.mkdir(fileDir, {recursive: true});
    }

    console.log(`Writing code to file: ${filePath}`);
    await fs.promises.writeFile(filePath, cleanCodeBlock, {flag: 'w'});
};

const calculateProjectCompletion = (completedTasks, totalTasks) => {
    if (completedTasks === 0) {
        return 0;
    }

    let taskCount = totalTasks;

    const progress = Math.min((completedTasks / taskCount) * 100, 100);
    return progress;
};

const generateBestAppState = async (problemStatement, projectType) => {
    let maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
        const prompt = `Generate the best app state for a ${projectType} project based on the following problem statement:
  ${problemStatement}
  
  Consider all the features and functionalities required for the project, including the necessary components, dependencies, and configurations.
  If its a clone of a popular website, consider the features and functionalities of the original website.
  Consider the following criteria when generating the app state:
  - Production-readiness: The app state should include necessary components for a production-ready application, such as Docker configuration, testing, and deployment strategies.
  - Comprehensive functionality: The app state should cover all the required features and functionalities outlined in the problem statement.
  - Scalability and performance: The app state should be designed for scalability and optimized for performance.
  - Code quality and best practices: The app state should follow industry best practices and maintain high code quality.
  
  The generated app state should represent the theoretical result of a Monte Carlo Tree Search (MCTS) algorithm, considering the above criteria as the scoring function.
  
  Please provide the app state as a well-formatted JSON object with the following structure:
  {
    "nodes": [
      {
        "id": "node_id",
        "type": "node_type",
        "properties": {
        "problemStatement": "problem_statement",
        "projectType": "project_type",
        "fileStructure": {
            "folder1": {
                "file1": "file_content",
                "file2": "file_content"
        },
            "folder2": {
                "file3": "file_content"
            },
        },
        "dependencies": ["dependency1", "dependency2"],
        "configurations": {
            "key1": "value1",
            "key2": "value2"
        }
        },
      }
    ]
  }
  
  Ensure that the JSON is properly formatted with all necessary closing brackets and braces.
  
  <thinking>
  Use chain of thought reasoning and include your thought process here.
  </thinking>
  
  <app_state>
  Provide the final app state JSON here.
  </app_state>
  `;

        const responses = [];
        for (let i = 0; i < 5; i++) {
            const response = await anthropic.messages.create({
                model: 'claude-3-haiku-20240307',
                max_tokens: 4096,
                messages: [{role: 'user', content: prompt}],
            });

            console.log(`Response: ${i + 1}`, extractResponseText(response));
            responses.push(extractResponseText(response));
        }

        console.log('Responses:', responses)

        const votingPrompt = `Given the following 5 app state responses, vote on the one with most comprehensive solution leading to a production-ready web application after generating and executing a task tree made from the app state. 
    Only respond with a single number with no additional text or explanations.
  ${responses.map((response, index) => `Response ${index + 1}:\n${response}`).join('\n\n')}`;
        const votingResponse = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 4096,
            messages: [{role: 'user', content: votingPrompt}],
        });

        const votingResult = extractResponseText(votingResponse);
        console.log('Voting result:', votingResult);

// Extract the vote number from the voting result
        const voteNumber = votingResult.trim().split(/\D+/)[0];
        console.log('Vote number:', voteNumber);
        const selectedIndex = voteNumber ? parseInt(voteNumber) - 1 : 0;
        console.log('Selected index:', selectedIndex);


        try {
            const selectedAppStateJson = extractAppStateJson(responses[selectedIndex]);

            const appState = JSON.parse(selectedAppStateJson);
            return appState;
        } catch (error) {
            console.error('Error parsing app state:', error);
            return null;
        }
    }
};

const extractAppStateJson = (responseText) => {
    // Extract the app state JSON from the response text
    const appStateRegex = /<app_state>(.*?)<\/app_state>/gs;
    const appStateMatches = responseText.match(appStateRegex);

    if (appStateMatches && appStateMatches.length > 0) {
        const lastAppStateMatch = appStateMatches[appStateMatches.length - 1];
        let appStateJson = lastAppStateMatch.replace(/<\/?app_state>/g, '').trim();

        // Remove any leading or trailing characters that are not part of the JSON
        appStateJson = appStateJson.replace(/^[^{]*/, '').replace(/[^}]*$/, '');

        // Remove any extra spaces or newline characters within the JSON
        appStateJson = appStateJson.replace(/\s+/g, '');

        // Check if the JSON is properly formatted
        if (appStateJson.startsWith('{') && appStateJson.endsWith('}')) {
            try {
                const parsedAppState = JSON.parse(appStateJson);
                return JSON.stringify(parsedAppState);
            } catch (error) {
                console.error('Error parsing app state:', error);
            }
        }
    }

    return null;
};

const solveProblem = async (problemStatement, projectType, io, projectId) => {
    console.log('Solving problem:', problemStatement, projectType, projectId);
    try {
        problemStatement = problemStatement;
        const projectPaths = new Set();
        const outputDirPath = path.join('output', projectId);
        const projectDirPath = path.join('projects', projectId);

        const bestAppState = await generateBestAppState(problemStatement, projectType);
        let executedTasks = loadCompletedTasks(projectDirPath) || [];
        console.log('executedTasks:', executedTasks);
        let taskTree;
        let formattedTree;
        const loadedTaskTree = loadTaskTree(projectDirPath);
        if (loadedTaskTree) {
            formattedTree = loadedTaskTree.split('\n').filter(line => line.match(/\d/)).join('\n');
            taskTree = parseTaskTree(loadedTaskTree);

        } else {
            //components = await outlineComponents(outline);
            formattedTree = await loadTaskTree(problemStatement);
            if (!formattedTree) {
                console.log('Generating task tree...');
                io.emit('phase_update', {phase: `Generating Tasks...`})
                const response = await breakDownProblem(problemStatement, bestAppState);
                formattedTree = response.taskTree;
                console.log('Formatted Tree:', formattedTree);
            }


            await saveTaskTree(formattedTree, projectDirPath);

            taskTree = parseTaskTree(formattedTree);
        }

        // let fileStructure = loadFileStructure(projectDirPath);
        // if (!fileStructure) {
        //     console.log('Generating file structure...');
        //     let isSufficient = false;
        //     while (!isSufficient) {
        //         fileStructure = await generateFileStructure(formattedTree, problemStatement);
        //         isSufficient = await checkFileStructure(fileStructure, problemStatement);
        //     }
        //
        //     console.log('File Structure:', JSON.stringify(fileStructure, null, 2));
        //     saveFileStructure(fileStructure, projectDirPath);
        // }

        let totalTasks = await countLeafNodes(taskTree);

        console.log(`Total tasks: ${totalTasks}`);
        console.log('Completed tasks:', executedTasks.length, 'Total tasks:', totalTasks);
        let projectCompletion = calculateProjectCompletion(executedTasks.length, totalTasks);
        io.emit('progress_update', {progress: projectCompletion});

        if (executedTasks.length < totalTasks) {
            //remove completed tasks from task tree
            const remainingFormattedTasks = formattedTree.split('\n').filter(task => !executedTasks.includes(task)).join('\n');
            const remainingTasks = parseTaskTree(remainingFormattedTasks);
            //get lenght of remainingformatted tasks

            await traverseTaskTree(remainingFormattedTasks, remainingTasks, totalTasks, bestAppState, executedTasks, projectId, io);
        }

        saveCompletedTasks(executedTasks, projectDirPath);

        console.log('Completed tasks:', executedTasks.length, 'Total tasks:', totalTasks);
        projectCompletion = calculateProjectCompletion(executedTasks.length, totalTasks);

        console.log('Project completion:', projectCompletion);
        io.emit('phase_update', {phase: `Code Generation Phase Complete. Attempting to build the project`});

        //await runBuildRevisionLoop(formattedTree, taskTree, bestAppState, totalTasks, projectPaths, executedTasks, io, projectId);
        projectCompletion = 100;
        if (projectCompletion === 100) {
            io.emit('phase_update', {phase: `Project Build Complete. Creating ZIP file for project`});
            console.log('Creating ZIP file for project');
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

                // Remove the project-specific directories
                fs.rm(outputDirPath, {recursive: true, force: true}, (err) => {
                    if (err) {
                        console.error(`Error deleting directory ${outputDirPath}:`, err);
                    } else {
                        console.log(`Deleted directory ${outputDirPath}`);
                    }
                });

                fs.rm(projectDirPath, {recursive: true, force: true}, (err) => {
                    if (err) {
                        console.error(`Error deleting directory ${projectDirPath}:`, err);
                    } else {
                        console.log(`Deleted directory ${projectDirPath}`);
                    }
                });
            });

            archive.on('error', (err) => {
                throw err;
            });

            archive.pipe(output);
            archive.directory(outputDirPath, false);
            await archive.finalize();
        }

        return projectCompletion;
    } catch (error) {
        console.error('Error during problem-solving:', error);
        throw error;
    }
};

const loadFileStructure = (projectDirPath) => {
    const filename = `fileStructure.json`;
    const filePath = path.join(projectDirPath, filename);

    if (fs.existsSync(filePath)) {
        const fileStructureData = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(fileStructureData);
    }

    return null;
};

const saveFileStructure = (fileStructure, projectDirPath) => {
    // Save the JSON task tree to a JSON file
    const filename = `fileStructure.json`;
    const filePath = path.join(projectDirPath, filename);

    if (!fs.existsSync(projectDirPath)) {
        fs.mkdirSync(projectDirPath, {recursive: true});
    }

    fs.writeFileSync(filePath, JSON.stringify(fileStructure, null, 2));

};

const generateFileStructure = async (formattedTree, problemStatement) => {
    console.log('inside generateFileStructure');
    const prompt = `
    Github Project Prompt: ${problemStatement}
    Formatted Tree for reference: ${formattedTree}

    Before generating the file structure outline, please think through the problem step-by-step within <thinking></thinking> tags.
    
    Then, generate a comprehensive JSON Lines formatted 'file structure outline' that produces a production ready GitHub repository that satisfies the project prompt.
    Respond with JSON Lines format for each file or folder that needs to be created.
    Do not include any additional text or explanations outside the <thinking> and <JSONLines> tags.
    Use pnpm for package management and actively maintained libraries.
    Including essential files like README.md and client/package.json and server/package.json are the most important for a successful project.
    The README.md file should include the following sections:
    - Overview section
    - Project structure
    - Technologies and libraries section
    - Build process and deployment section
    - Testing and debugging section
    - Project completion criteria section
    - Deployment configuration section
    
    Additionally, include the following:
    - Separate folders for client-side and server-side code
    - A dedicated folder for unit tests, integration tests, and end-to-end tests (e.g., __tests__)
    - A folder for static assets (e.g., images, fonts)
    - Separate .env files for different environments (e.g., .env.development, .env.production)
    - Dedicated folders for utilities, shared components, hooks, and state management (if applicable)
    - All necessary files in each folder to ensure the project can be built and deployed successfully
    - A folder for global styles or component-specific styles
    - Dockerfile in each client and server, docker-compose.yml in root directory
    
    Return each file or folder as a separate JSON object in the JSON Lines format, with the following structure:
    
    <JSONLines>
    {"path": "/client/src/file", "imports": [...], "functionHeaders": [...]}
    {"path": "/server/src/file", "imports": [...], "functionHeaders": [...]}
    {"path": "/README.md", "imports": [...], "functionHeaders": [...]}
    </JSONLines>
    
    The "path" key in the JSON Line object should contain the relative path to the file or folder, starting from the root directory.
    The "imports" key in the JSON Line object should be an array of import statements relevant to the file.
    The "functionHeaders" key in the JSON Line object should be an array of function headers or any other relevant information for the file.
    
    The task tree is created from this structure, so please include all functions necessary for each file to be correctly implemented.
    Use "/client/" for the client-side code and "/server/" for the server-side code.
    
    Use pnpm for package management and actively maintained libraries.
    
    Include function headers and imports that are relevant to other file creation tasks.
    Provide each file or folder as a separate JSON object in the JSON Lines format, without any additional text or explanations.

    Do not include a root object or array in your response, as it will be treated as a JSONL format.
    Do not include any additional text or explanations outside the <thinking> and <JSONLines> tags.
    `;

    const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4096,
        messages: [{role: 'user', content: prompt}],
    });

    const responseText = extractResponseText(response);
    const thinkingMatch = responseText.match(/<thinking>([\s\S]*?)<\/thinking>/);
    const thinking = thinkingMatch ? thinkingMatch[1].trim() : '';
    console.log('Thinking:', thinking);

    const jsonlmatch = responseText.match(/<JSONLines>([\s\S]*?)<\/JSONLines>/);
    const jsonlines = jsonlmatch ? jsonlmatch[1].trim() : '';
    console.log('JSONLines:', jsonlines);
    const jsonLines = jsonlines.trim().split('\n').filter(line => {
        try {
            JSON.parse(line);
            return true;
        } catch (error) {
            console.warn(`Skipping non-JSON line: ${line}`);
            return false;
        }
    });

    try {
        const jsonResponse = jsonLines.map(line => JSON.parse(line));
        return {thinking, fileStructure: jsonResponse};
    } catch (error) {
        console.error('Error executing task:', error);
        return {thinking: '', fileStructure: null};
    }
};


const checkFileStructure = async (fileStructure, problemStatement) => {
    const prompt = `
    Problem Statement: ${problemStatement}
    File Structure: ${JSON.stringify(fileStructure)}
    
    Check if the provided file structure is sufficient to produce a professional and polished Github repository that satisfies the problem statement and outline and can be successfully deployed to production (containerized with Docker).
    
    If the file structure is not sufficient, return the word "false".
    
    Do not include any explanations or additional text. 
    Only the boolean "False" if the file structure is insufficient or "True" if the file structure is sufficient.
  `;

    const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        messages: [{role: 'user', content: prompt}],
    });

    const responseText = extractResponseText(response);
    console.log('File structure check response:', responseText);
    return responseText.toLowerCase().includes('true');
}

const uploadProjectToS3 = async (projectId, io, fileStream) => {
    const uploadParams = {
        Bucket: process.env.DO_SPACES_BUCKET,
        Key: `projects/${projectId}.zip`,
        Expires: 60 * 5, // URL expiration time in seconds (e.g., 5 minutes)
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

const generateOutline = async (problemStatement) => {
    const prompt = `
Project Statement: ${problemStatement}

Max Tokens: 4096

Generate an outline of a professional and polished Github repository that satisfies the project statement and will produce a fully working production deployed web application (containerized with Docker) using best practices like Test-Driven Development (TDD) and automated processes.
Use pnpm for package management and actively maintained libraries.

Please do not include any explanations or additional text in the response.

The outline should include the following sections formatted as JSON objects, with each JSON object on a separate line (JSON Lines format):

{"section": "Project Description", "content": "..."}
{"section": "Features and Functionality", "content": "..."}
{"section": "User Stories", "content": "..."}
{"section": "User Interface Design", "content": "..."}
{"section": "Data Models and Database Schema", "content": "..."}
{"section": "API Endpoints and Routes", "content": "..."}
{"section": "Authentication and Authorization", "content": "..."}
{"section": "Testing Strategy", "content": "..."}
{"section": "Error Handling and Validation", "content": "..."}
{"section": "Containerization and Docker", "content": "..."}
{"section": "Deployment and Hosting", "content": "..."}
{"section": "Technologies and Tools", "content": "..."}

Do not include any explanations or additional text.

This information will be included in the context for each task execution to ensure the code is implemented correctly.

Keep dependencies simple so the project can be generated with the LLM script and built with Docker Compose without errors. The script will run the build command at the end of the process, so be cautious with the dependencies.

Make technical decisions based on the user's problem statement and include any specific technologies mentioned in the problem statement.

`;

    const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4096,
        messages: [{role: 'user', content: prompt}],
    });

    const responseText = extractResponseText(response);
    console.log('Outline:', responseText);

    // Removed the problematic JSON.parse attempt.

    const jsonLines = responseText.trim().split('\n');
    const jsonResponse = [];

    for (const line of jsonLines) {
        try {
            const jsonObject = JSON.parse(line);
            jsonResponse.push(jsonObject);
        } catch (error) {
            console.warn('Skipping non-JSON line:', line);
        }
    }

    return jsonResponse;
};

const getExistingFiles = (projectId) => {
    const outputDirPath = path.join('output', projectId);
    const existingFiles = [];

    if (fs.existsSync(outputDirPath)) {
        const getFiles = (dir) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                if (fs.statSync(filePath).isDirectory()) {
                    getFiles(filePath);
                } else {
                    const relativePath = path.relative(outputDirPath, filePath);
                    existingFiles.push(relativePath);
                }
            }
        };

        getFiles(outputDirPath);
    }

    return existingFiles;
};

const generateBuildErrorTasks = async (errorMessage, bestAppState, projectId) => {
    const existingFiles = getExistingFiles(projectId);
    console.log('Generating build error tasks:', errorMessage, bestAppState, projectId);
    const prompt = `
    Best App State from MCST: ${bestAppState}
    Just ran docker-compose up and got this Build Error: ${errorMessage}
    Max output length: 4096

    The project has been comprehensively implemented and is now in the build revision stage.
    
    Break down the provided build error into a Hierarchical Task Trie that will resolve the Docker Compose build errors.
    
    Do not generate tasks that involve running install commands or creating files that aren't normally written by a human. Only generate tasks that involve writing code snippets to files.
    For example, don't create a task like 'create pnpm-lock.yaml' or 'run pnpm install'.
    Do not generate tasks that have already been completed and do not relate to solving the build error.
    
    Do not generate tasks to create files that already exist.
    
    Example structure:
    1. Add missing package.json to the /client directory
        1.1. Add the package.json file to the /client directory
            1.1.1 Add the dependencies to the /client/package.json file
            1.1.2. Add the build script to the /client/package.json file
            1.1.3 Add the start script to the /client/package.json file
            1.1.4 Add the test script to the /client/package.json file
            
    2. Add missing package.json to the /server directory
        2.1. Add the package.json file to the /server directory
            2.1.1 Add the dependencies to the /server/package.json file
            2.1.2. Add the build script to the /server/package.json file
            2.1.3 Add the start script to the /server/package.json file
            2.1.4 Add the test script to the /server/package.json file

    The leaf node tasks need to be completable by a call to Claude 3 API and should include the filename so Claude can infer context along with the file structure.
    
    Use pnpm for package management and actively maintained libraries.
    
    Do not create tasks related to install scripts or setting up directories, only for file implementations.
    
    Only provide Hierarchical Task Trie with each line starting with a decimal and no other text.
    
    Each leaf node needs to have the file name in the task description.
    
    Only include the tree and no additional text.
    `;

    const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 4096,
        messages: [{role: 'user', content: prompt}],
    });

    const responseText = extractResponseText(response);
    const newTree = responseText.split('\n').filter(line => line.match(/\d/)).join('\n');
    const jsonTree = parseTaskTree(newTree);

    return jsonTree;
};

const countLeafNodes = async (taskTree) => {
    let totalTasks = 0;

    const traverseTree = (node) => {
        if (Array.isArray(node)) {
            node.forEach(child => {
                traverseTree(child);
            });
        } else if (typeof node === 'object' && node !== null) {
            if (!node.children || node.children.length === 0) {
                totalTasks++;
            } else {
                traverseTree(node.children);
            }
        }
    };

    traverseTree(taskTree);

    return totalTasks;
};

module.exports = {
    parseTaskTree,
    extractResponseText,
    executeTask,
    writeCodeToFile,
    traverseTaskTree,
    updateProjectPaths,
    calculateProjectCompletion,
    solveProblem,
    extractCodeBlocks,
    breakDownProblem,
};
