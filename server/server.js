const express = require('express');
const mongoose = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');
const dotenv = require('dotenv');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const {solveProblem} = require('./utils/taskTreeUtils');
const cors = require('cors');
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const endpointSecret = 'whsec_9cc4d1f7cccc5fbd118b4c76d2b5e61e5384d01f68468e5a4d77a831eb6ae2b4';
const archiver = require('archiver');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const getRawBody = require('raw-body');
const AWS = require('aws-sdk');
const spacesEndpoint = new AWS.Endpoint(process.env.DO_SPACES_ENDPOINT);
const s3 = new AWS.S3({
    endpoint: spacesEndpoint,
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
});

// User model
const User = require('./models/User');
const PaidProject = require('./models/PaidProject');
const {createProxyMiddleware} = require('http-proxy-middleware');
const anthropic = new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY});

dotenv.config();

const app = express();

const server = http.createServer(app);

const io = socketIO(server, {
    cors: {
        origin: 'https://saas-quick.com', // Replace with your client's URL
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type'], // Allow these headers
        credentials: true // Allow credentials (cookies, authorization headers, etc.)
    },
});

io.on('connection', (socket) => {
    console.log('A client connected');

    // Emit an event to the connected client
    socket.emit('welcome', {message: 'Hello from the server!'});

    // Listen for events from the client
    socket.on('clientEvent', (data) => {
        console.log('Received event from client:', data);
        // Handle the event data as needed
    });

    socket.on('disconnect', () => {
        console.log('A client disconnected');
    });
});

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication token is required'));
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            return next(new Error('Invalid authentication token'));
        }
        socket.userId = decoded.userId;
        next();
    });
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

function authenticateToken(req, res, next) {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).json({error: 'No token provided'});
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error('Token verification error:', err);
            return res.status(401).json({error: 'Invalid token'});
        }
        req.userId = decoded.userId;
        next();
    });
}

app.use(express.json());
app.use(cors({
    origin: 'https://saas-quick.com', // Allow requests from your client's origin
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allow specific HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allow specific headers
    credentials: true // Allow sending cookies and other credentials
}));
app.use(express.static(path.join(__dirname, 'client/build')));

app.post('/api/projects', authenticateToken, async (req, res) => {
    try {
        const {projectDescription, projectType, userId} = req.body;

        // Create a new PaidProject document
        const newProject = new PaidProject({
            userId,
            projectDescription,
            projectType,
            finished: false,
        });

        // Save the new project
        const savedProject = await newProject.save();

        res.status(201).json(savedProject);
    } catch (error) {
        console.error('Error creating new project:', error);
        res.status(500).json({error: 'An error occurred'});
    }
});

app.post('/build', authenticateToken, async (req, res) => {
    const {projectId, projectDescription, projectType, userId} = req.body;
    //confirm that user has the projectid
    const user = await User.findById(userId);
    console.log('user ', user);
    console.log('Received build request for project:', projectId);
    try {
        const project = await PaidProject.findOne({_id: projectId, userId: userId});
        //update project description and type
        project.projectDescription = projectDescription;
        project.projectType = projectType;
        await project.save();

        if (!project) {
            return res.status(404).json({error: 'Project not found'});
        }
        console.log('Paid project:', project);


        res.status(200).json({message: 'Project generation started'});
        await solveProblem(projectDescription, projectType, io, projectId);
        //update project finished to true
        project.finished = true;
        await project.save();

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({error: 'An error occurred'});
    }
});

app.delete('/api/projects/:projectId', authenticateToken, async (req, res) => {
    try {
        const project = await PaidProject.findOneAndDelete({
            _id: req.params.projectId,
            userId: req.userId,
        });
        if (!project) {
            return res.status(404).json({error: 'Project not found'});
        }
        res.json({message: 'Project deleted successfully'});
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({error: 'An error occurred'});
    }
});

app.get('/download/:projectId', authenticateToken, async (req, res) => {
    const {projectId} = req.params;
    console.log('Received download request for project:', projectId);
    try {
        const paidProject = await PaidProject.findById(projectId);
        console.log('Paid project:', paidProject);
        if (!paidProject) {
            return res.status(404).json({error: 'Project not found'});
        }

        if (paidProject.userId.toString() !== req.userId) {
            return res.status(403).json({error: 'Unauthorized access'});
        }

        if (!paidProject.finished) {
            return res.status(400).json({error: 'Project not finished'});
        }

        const downloadParams = {
            Bucket: process.env.DO_SPACES_BUCKET,
            Key: `projects/${projectId}.zip`,
            Expires: 60 * 5, // URL expiration time in seconds (e.g., 5 minutes)
        };

        const downloadUrl = await s3.getSignedUrl('getObject', downloadParams);
        res.json({downloadUrl});
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({error: 'An error occurred'});
    }
});

// Fetch all projects for the logged-in user
app.get('/api/projects', authenticateToken, async (req, res) => {
    try {
        const projects = await PaidProject.find({userId: req.userId});
        res.json(projects);
    } catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({error: 'An error occurred'});
    }
});

app.get('/api/projects/:projectId', authenticateToken, async (req, res) => {
    console.log('Received project details request for project:', req.params.projectId)
    try {
        const project = await PaidProject.findOne({_id: req.params.projectId, userId: req.userId});
        if (!project) {
            return res.status(404).json({error: 'Project not found'});
        }

        if (project.finished) {
            const downloadParams = {
                Bucket: process.env.DO_SPACES_BUCKET,
                Key: `projects/${project._id}.zip`,
                Expires: 60 * 5, // URL expiration time in seconds (e.g., 5 minutes)
            };

            //check if the file exists

            const downloadUrl = await s3.getSignedUrl('getObject', downloadParams);
            project.downloadUrl = downloadUrl;
        }

        res.json(project);
    } catch (error) {
        console.error('Error fetching project:', error);
        res.status(500).json({error: 'An error occurred'});
    }
});

app.post('/register', async (req, res) => {
    console.log('Received register request');
    const {username, password} = req.body;
    try {
        // Check if the user already exists
        const existingUser = await User.findOne({username});
        if (existingUser) {
            return res.status(400).json({error: 'Username already exists'});
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create a new user
        const newUser = new User({
            username,
            password: hashedPassword,
        });
        await newUser.save();

        res.status(201).json({message: 'User registered successfully'});
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({error: 'An error occurred while registering the user'});
    }
});

app.use('/login', (req, res, next) => {
    if (req.method === 'POST') {
        next(); // Allow POST requests to be handled by the existing route handler
    } else {
        res.status(405).header('Allow', 'POST').send('Method Not Allowed');
    }
});

app.post('/login', async (req, res) => {
    console.log('Received login request');
    const {username, password} = req.body;
    try {
        // Find the user by username
        const user = await User.findOne({username});
        if (!user) {
            return res.status(401).json({error: 'Invalid username or password'});
        }

        // Compare the provided password with the hashed password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({error: 'Invalid username or password'});
        }

        // Generate a JWT token
        const token = jwt.sign({userId: user._id}, process.env.JWT_SECRET, {expiresIn: '1h'});
        io.emit('user_login', {userId: user._id});
        console.log('User logged in successfully');

        res.status(200).json({token});
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({error: 'An error occurred while logging in'});
    }
});

app.get('/user', authenticateToken, async (req, res) => {
    try {
        const userId = req.userId;

        // Find the user by ID
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({error: 'User not found'});
        }

        // Return the user data and balance
        res.status(200).json({
            user: {
                id: user._id,
                username: user.username,
            },
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({error: 'An error occurred while fetching user data'});
    }
});

app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    let event = req.body;
    //console.log('Received webhook event:', JSON.stringify(event, null, 2));

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            const customerId = session.customer;
            const amount = session.amount_total / 100; // Convert cents to dollars

            console.log(`Payment received for customer ${customerId}. Amount: $${amount}`);

            try {
                const user = await User.findOne({stripeCustomerId: customerId});
                console.log('User:', user);
                if (!user) {
                    console.error(`User with Stripe customer ID ${customerId} not found`);
                } else {
                    console.log(`Build payment processed successfully for user ${user._id}.`);


                    console.log('Session:', session)
                    // Find the project by ID
                    const project = await PaidProject.findById(session.client_reference_id);
                    console.log('Project:', project);
                    if (!project) {
                        console.error(`Project with ID ${session.client_reference_id} not found`);
                    } else {
                        // Update the project to paid
                        project.paid = true;
                        await project.save();
                        console.log(`Project ${project._id} updated to paid`);
                    }
                }
            } catch (error) {
                console.error('Error paying for build', error);
            }
            break;

        case 'customer.updated':
        case 'charge.succeeded':
        case 'payment_intent.succeeded':
        case 'payment_intent.created':
            // Handle other event types if needed
            break;

        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.status(200).send();
});

app.post('/create-checkout-session', authenticateToken, async (req, res) => {
    console.log('Received create checkout session request', req)
    console.log('Received create checkout session request', req.body)
    const amount = 29; // Amount in dollars
    const projectId = req.body.projectId;

    console.log('Received create checkout session request', projectId)
    try {
        // Find the user by ID
        let user = await User.findById(req.userId);

        // If the user doesn't have a Stripe customer ID, create a new customer
        let customerId = user.stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create();
            customerId = customer.id;

            // Update the user with the Stripe customer ID
            user = await User.findByIdAndUpdate(
                req.userId,
                {stripeCustomerId: customerId},
                {new: true}
            );
        }

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'Flat Fee for Repo Generation',
                        },
                        unit_amount: amount * 100, // Stripe expects the amount in cents
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${process.env.CLIENT_URL}/edit`,
            cancel_url: `${process.env.CLIENT_URL}/edit`,
            customer: customerId, // Associate the customer with the checkout session
            client_reference_id: projectId,
        });


        res.status(200).json({sessionId: session.id});
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({error: 'An error occurred while creating the checkout session'});
    }
});

// Catch-all route for serving the React app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname + '/client/build/index.html'));
});

// Start the server
const PORT = process.env.PORT || 4242;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
