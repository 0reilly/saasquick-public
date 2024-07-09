import React, {useState, useEffect, useRef} from 'react';
import axios from 'axios';
import io from 'socket.io-client';
import {loadStripe} from '@stripe/stripe-js';
import {navigate, useParams} from '@reach/router';
import {motion, AnimatePresence} from 'framer-motion';
import ReactMarkdown from 'react-markdown';

const ProjectDetailsPage = ({selectedProjectId}) => {
    const [projectDescription, setProjectDescription] = useState('');
    const [projectType, setProjectType] = useState('web');
    const [progress, setProgress] = useState(0);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const socketRef = useRef(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadReady, setDownloadReady] = useState(false);
    const [userId, setUserId] = useState(null);
    const [showRegisterForm, setShowRegisterForm] = useState(false);
    const [user, setUser] = useState(null);
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [hasPaid, setHasPaid] = useState(false);
    const [projects, setProjects] = useState([]);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [fileResponse, setFileResponse] = useState(null);
    const [project, setProject] = useState(null);
    const [downloadUrl, setDownloadUrl] = useState(null);
    const [projectPhase, setProjectPhase] = useState(!downloadUrl ? 'Ready to Generate Project' : 'Project Completed. Zip file ready for download.');
    const stripePromise = loadStripe('pk_live_51BQIZJFRs2YmnLPIMK5D38WojCyNq7yQmzeV0EN7Jw47Wmu5Ev3vXF6XoP1lcIkd4ANVFDPrQNXeochTbw7WqYoG00p482Dh50');

    const handleBackToProjects = async () => {
        await navigate('/projects');
    };

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            fetchUserData(token);
        } else {
            navigate('/');
        }
        const userIdFromStorage = localStorage.getItem('userId');
        if (userIdFromStorage) {
            setUserId(userIdFromStorage);
        }
    }, []);

    useEffect(() => {
        const fetchProject = async () => {
            try {
                const response = await axios.get(`/api/projects/${selectedProjectId}`, {
                    headers: {
                        Authorization: `${localStorage.getItem('token')}`,
                    },
                });

                setProject(response.data);
                setProjectDescription(response.data.projectDescription);
                setProjectType(response.data.projectType);
                const finished = response.data.finished;
                if (finished) {
                    setProgress(100);
                    setDownloadUrl(response.data.downloadUrl);
                    setIsComplete(true)
                    setDownloadReady(true);
                } else {
                    setDownloadReady(false);
                    setIsComplete(false);
                }
            } catch (error) {
                console.error('Error fetching project:', error);
            }
        };

        if (selectedProjectId) {
            fetchProject();
        } else {
            setHasPaid(false)
        }
    }, [selectedProjectId]);


    useEffect(() => {
        if (user) {
            setUserId(user.id);
            setShowAuthModal(false);
            setShowProfileModal(false);
        }
    }, [user, userId]);

    const fetchUserData = async (token) => {
        try {
            const response = await axios.get('/user', {
                headers: {
                    Authorization: token,
                },
            });
            setUser(response.data.user);
            setIsLoading(false);
        } catch (error) {
            setIsLoading(false);
            console.error('Error fetching user data:', error);
        }
    };

    useEffect(() => {
        const fetchProject = async () => {
            try {
                const response = await axios.get(`/api/projects/${selectedProjectId}`, {
                    headers: {
                        Authorization: `${localStorage.getItem('token')}`,
                    },
                });


                setHasPaid(response.data.paid);
            } catch (error) {
                console.error('Error fetching project:', error);
            }
        };

        if (selectedProjectId) {
            fetchProject();
        } else {
            setHasPaid(false)
        }
    }, [selectedProjectId]);

    useEffect(() => {
        const fetchProjects = async () => {
            try {
                const response = await axios.get('/api/projects', {
                    headers: {
                        Authorization: `${localStorage.getItem('token')}`,
                    },
                });
                setProjects(response.data);
            } catch (error) {
                console.error('Error fetching projects:', error);
            }
        };

        fetchProjects();
    }, [userId]);


    useEffect(() => {
        const token = localStorage.getItem('token');
        const setupWebSocket = () => {
            const socket = io('/',
                {
                    auth: {
                        token: token,
                    },
                });
            socketRef.current = socket;

            socket.on('progress_update', (data) => {
                setProgress(Math.floor(data.progress));
                console.log(`Progress update: ${data.progress}`);

            });

            socket.on('project_generated', (data) => {
                if (data.url) {
                    setDownloadUrl(data.url);
                    setDownloadReady(true);
                    setProjectPhase('Project Completed. Zip file ready for download.');
                } else {
                    setProjectPhase('Project generation failed. Please try again.');
                }
            });

            socket.on('phase_update', (data) => {
                    console.log('Phase update:', data);
                    setProjectPhase(data.phase);
                }
            );


            socket.on('user_login', (data) => {
                console.log('User logged in:', data);
                setUserId(data.userId);
                localStorage.setItem('userId', data.userId);
            });

            socket.on('payment_completed', (userId) => {
                console.log('Payment completed for user:', userId);
                setHasPaid(true);
                setShowPaymentModal(false);
            });


            return () => {
                socket.disconnect();
            };
        };

        setupWebSocket();

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, [userId]);

    function showMessage(message, type = 'info') {
        const messageDiv = document.getElementById('messageDiv') || createMessageDiv();
        messageDiv.textContent = message;
        messageDiv.className = `alert alert-${type}`;
        messageDiv.style.display = 'block';
    }

    function createMessageDiv() {
        const div = document.createElement('div');
        div.id = 'messageDiv';
        div.className = 'alert mt-3';
        document.body.appendChild(div);
        return div;
    }

    useEffect(() => {
        if (hasPaid) {
            console.log('User has paid');
            setShowPaymentModal(false);
        }
    }, [hasPaid]);


    useEffect(() => {
        if (downloadUrl) {
            setIsComplete(true)
            setDownloadReady(true);
            console.log('Download URL:', downloadUrl);
        }
    }, [downloadUrl])


    const handleSubmit = async (e) => {
        if (e) {
            e.preventDefault();
        }

        setIsGenerating(true);

        console.log('calling build with project description:', projectDescription, 'projectType:', projectType, 'userId:', userId, 'selectedProjectId', selectedProjectId);
        try {
            const response = await axios.post(
                '/build',
                {
                    projectId: selectedProjectId,
                    projectDescription,
                    projectType,
                    userId,
                },
                {
                    headers: {
                        Authorization: localStorage.getItem('token'),
                    },
                }
            );

            console.log(response.data.message);
        } catch (error) {
            console.error('Error:', error);
        }
    };
    const handleRegister = (e) => {
        e.preventDefault();
        // Perform register logic
        axios.post('/register', {
            username: e.target.username.value,
            password: e.target.password.value,
        })
            .then((response) => {
                console.log(response.data.message);
                // Handle successful registration, e.g., show a success message or redirect to login
            })
            .catch((error) => {
                console.error('Registration error:', error);
                // Handle registration error, e.g., show an error message to the user
            });
    };

    const handleLogin = (e) => {
        e.preventDefault();
        // Perform login logic
        axios.post('/login', {
            username: e.target.username.value,
            password: e.target.password.value,
        })
            .then((response) => {
                const {token} = response.data;
                console.log('Login successful:', token)
                localStorage.setItem('token', token);
                fetchUserData(token);
                setShowAuthModal(false);
            })
            .catch((error) => {
                console.error('Login error:', error);
            });
    };

    const handleAddFunds = async (e) => {
        e.preventDefault();

        try {
            const response = await axios.post(
                '/create-checkout-session',
                {
                    projectId: selectedProjectId,
                },
                {
                    headers: {
                        Authorization: localStorage.getItem('token'),
                    },
                }
            );

            const {sessionId} = response.data;
            const stripe = await stripePromise;
            const {error} = await stripe.redirectToCheckout({sessionId});

            if (socketRef.current) {
                socketRef.current.emit('payment_completed', userId);
            }

            if (error) {
                console.error('Stripe Checkout error:', error);
            }
        } catch (error) {
            console.error('Error creating Stripe Checkout session:', error);
        }
    };

    const handleDownload = async () => {
        try {
            setIsDownloading(true); // Set isDownloading to true when the download starts
            if (!downloadUrl) {
                const response = await axios.get(`/download/${selectedProjectId}`,
                    {
                        headers: {
                            Authorization: localStorage.getItem('token'),
                        },
                    });

                //expect res.json({downloadUrl})
                const url = response.data.downloadUrl;
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', 'project.zip');
                document.body.appendChild(link);
                link.click();
                link.remove();
                setIsDownloading(false); // Set isDownloading to false when the download is complete
            } else {
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.setAttribute('download', 'project.zip');
                document.body.appendChild(link);
                link.click();
                link.remove();
                setIsDownloading(false); // Set isDownloading to false when the download is complete
            }

        } catch (error) {
            console.error('Error downloading project:', error);
            setIsDownloading(false); // Set isDownloading to false if an error occurs
        }
    };

    const handleLogout = async () => {
        localStorage.removeItem('token');
        setUser(null);
        await navigate('/');
    };

    return (
        <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            style={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: '100vh',
                backgroundColor: 'white',
                color: '#1a202c'
            }}
        >
            <header className="border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                    <motion.h1
                        initial={{ y: -20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="text-2xl font-semibold flex items-center"
                    >
                        SaaS Quick
                        <span className="bg-blue-100 text-blue-600 ml-2 px-2 py-1 rounded-full text-xs font-normal">Beta</span>
                    </motion.h1>
                    <nav>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={handleBackToProjects}
                            className="bg-gray-100 text-gray-900 px-4 py-2 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors duration-300 mr-2"
                        >
                            Back to Projects
                        </motion.button>
                        {user ? (
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={handleLogout}
                                className="bg-blue-500 text-white px-4 py-2 rounded-full focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors duration-300"
                            >
                                Logout
                            </motion.button>
                        ) : (
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setShowAuthModal(true)}
                                className="bg-blue-500 text-white px-4 py-2 rounded-full hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-300"
                            >
                                Login
                            </motion.button>
                        )}
                    </nav>
                </div>
            </header>

            <main
                style={{
                    maxWidth: '80rem',
                    margin: '0 20rem',
                    padding: '2rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2rem'
                }}
            >
                <motion.div
                    initial={{y: 20, opacity: 0}}
                    animate={{y: 0, opacity: 1}}
                    transition={{delay: 0.4}}
                    style={{
                        backgroundColor: 'white',
                        borderRadius: '1rem',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                        padding: '1.5rem'
                    }}
                >
                    <h2 style={{fontSize: '1.5rem', fontWeight: '600', marginBottom: '1rem'}}>Project Details</h2>
                    {hasPaid || (user && user.username === ('adamoreilly' || 'gr00ve')) ? (
                        <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                            <div>
                                <label
                                    htmlFor="project-description"
                                    style={{
                                        display: 'block',
                                        marginBottom: '0.5rem',
                                        fontSize: '0.875rem',
                                        fontWeight: '500',
                                        color: '#4a5568'
                                    }}
                                >
                                    Project Description
                                </label>
                                <textarea
                                    id="project-description"
                                    name="project-description"
                                    rows="5"
                                    value={projectDescription}
                                    onChange={(e) => setProjectDescription(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '0.5rem 0.75rem',
                                        backgroundColor: '#f7fafc',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '0.375rem',
                                        fontSize: '1rem',
                                        color: '#4a5568'
                                    }}
                                    placeholder="Enter a detailed description of your project..."
                                    required
                                ></textarea>
                            </div>
                            <div>
                                <label
                                    htmlFor="project-type"
                                    style={{
                                        display: 'block',
                                        marginBottom: '0.5rem',
                                        fontSize: '0.875rem',
                                        fontWeight: '500',
                                        color: '#4a5568'
                                    }}
                                >
                                    Project Type
                                </label>
                                <select
                                    id="project-type"
                                    name="project-type"
                                    value={projectType}
                                    onChange={(e) => setProjectType(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '0.5rem 0.75rem',
                                        backgroundColor: '#f7fafc',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '0.375rem',
                                        fontSize: '1rem',
                                        color: '#4a5568'
                                    }}
                                    required
                                >
                                    <option value="web">Web Application</option>
                                    <option value="mobile">Mobile Application</option>
                                </select>
                            </div>
                            <motion.button
                                whileHover={{scale: 1.05}}
                                whileTap={{scale: 0.95}}
                                type="submit"
                                disabled={!projectDescription || !userId || !user || isGenerating}
                                style={{
                                    width: '100%',
                                    backgroundColor: '#3b82f6',
                                    color: 'white',
                                    padding: '0.75rem',
                                    borderRadius: '9999px',
                                    fontWeight: '600',
                                    fontSize: '1rem',
                                    border: 'none',
                                    cursor: 'pointer',
                                    transition: 'all 300ms',
                                    opacity: (!projectDescription || !userId || !user || isGenerating) ? '0.5' : '1',
                                    pointerEvents: (!projectDescription || !userId || !user || isGenerating) ? 'none' : 'auto'
                                }}
                            >
                                {isGenerating ? 'Generating...' : 'Build Project'}
                            </motion.button>
                        </form>
                    ) : (
                        <motion.button
                            whileHover={{scale: 1.05}}
                            whileTap={{scale: 0.95}}
                            style={{
                                width: '100%',
                                backgroundColor: '#3b82f6',
                                color: 'white',
                                padding: '0.75rem',
                                borderRadius: '9999px',
                                fontWeight: '600',
                                fontSize: '1rem',
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'all 300ms'
                            }}
                            onClick={() => setShowProfileModal(true)}
                        >
                            Unlock Build
                        </motion.button>
                    )}
                </motion.div>

                {selectedProjectId && project && (
                    <motion.div
                        initial={{y: 20, opacity: 0}}
                        animate={{y: 0, opacity: 1}}
                        transition={{delay: 0.6}}
                        style={{
                            marginTop: '2rem',
                            backgroundColor: 'white',
                            borderRadius: '1rem',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                            padding: '1.5rem'
                        }}
                    >
                        <h2
                            style={{
                                fontSize: '1.5rem',
                                fontWeight: '600',
                                marginBottom: '1rem'
                            }}
                        >Project Generation Progress</h2>
                        <div style={{position: 'relative', paddingTop: '0.25rem'}}>
                            <div
                                style={{
                                    display: 'flex',
                                    marginBottom: '0.5rem',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}
                            >
                                <div>
                                    <span
                                        style={{
                                            fontSize: '0.75rem',
                                            fontWeight: '600',
                                            padding: '0.25rem 0.5rem',
                                            borderRadius: '9999px',
                                            backgroundColor: '#ebf8ff',
                                            color: '#3b82f6'
                                        }}
                                    >
                                        Progress
                                    </span>
                                </div>
                                <div>
                                    <span style={{fontSize: '0.75rem', fontWeight: '600', color: '#3b82f6'}}>
                                        {progress}%
                                    </span>
                                </div>
                            </div>
                            <div
                                style={{
                                    overflow: 'hidden',
                                    height: '0.5rem',
                                    borderRadius: '9999px',
                                    backgroundColor: '#ebf8ff'
                                }}
                            >
                                <motion.div
                                    style={{
                                        width: `${progress}%`,
                                        height: '100%',
                                        backgroundColor: '#3b82f6'
                                    }}
                                    initial={{width: 0}}
                                    animate={{width: `${progress}%`}}
                                    transition={{duration: 0.5}}
                                ></motion.div>
                            </div>
                        </div>
                        <div style={{color: '#4a5568', marginTop: '1rem', marginBottom: '1rem'}}>
                            <ReactMarkdown>{projectPhase}</ReactMarkdown>
                        </div>
                        {isComplete && (
                            <div style={{marginTop: '1rem'}}>
                                {isDownloading ? (
                                    <div style={{display: 'flex', alignItems: 'center', color: '#4a5568'}}>
                                        <svg
                                            style={{
                                                animation: 'spin 1s linear infinite',
                                                marginRight: '0.75rem',
                                                height: '1.25rem',
                                                width: '1.25rem'
                                            }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        >
                                            <circle
                                                style={{opacity: 0.25}}
                                                cx="12"
                                                cy="12"
                                                r="10"
                                                stroke="currentColor"
                                                strokeWidth="4"
                                            ></circle>
                                            <path
                                                style={{opacity: 0.75}}
                                                fill="currentColor"
                                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                            ></path>
                                        </svg>
                                        Downloading project...
                                    </div>
                                ) : downloadReady ? (
                                    <motion.button
                                        whileHover={{scale: 1.05}}
                                        whileTap={{scale: 0.95}}
                                        onClick={handleDownload}
                                        style={{
                                            backgroundColor: '#48bb78',
                                            color: 'white',
                                            padding: '0.75rem 1rem',
                                            borderRadius: '9999px',
                                            fontWeight: '600',
                                            fontSize: '1rem',
                                            border: 'none',
                                            cursor: 'pointer',
                                            transition: 'all 300ms'
                                        }}
                                    >
                                        Download Project
                                    </motion.button>
                                ) : (
                                    <p style={{color: '#4a5568'}}>Preparing download...</p>
                                )}
                            </div>
                        )}
                    </motion.div>
                )}
            </main>

            <AnimatePresence>
                {showPaymentModal && (
                    <motion.div
                        initial={{opacity: 0}}
                        animate={{opacity: 1}}
                        exit={{opacity: 0}}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 50,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0, 0, 0, 0.5)'
                        }}
                    >
                        <motion.div
                            initial={{y: -50, opacity: 0}}
                            animate={{y: 0, opacity: 1}}
                            exit={{y: -50, opacity: 0}}
                            style={{
                                backgroundColor: 'white',
                                borderRadius: '1rem',
                                padding: '2rem',
                                maxWidth: '28rem',
                                width: '100%',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                            }}
                        >
                            <h2
                                style={{
                                    fontSize: '1.5rem',
                                    fontWeight: '700',
                                    marginBottom: '1rem',
                                    color: '#1a202c'
                                }}
                            >Pay to Unlock</h2>
                            <form
                                onSubmit={handleAddFunds}
                                style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}
                            >
                                <motion.button
                                    whileHover={{scale: 1.05}}
                                    whileTap={{scale: 0.95}}
                                    type="submit"
                                    style={{
                                        width: '100%',
                                        backgroundColor: '#3b82f6',
                                        color: 'white',
                                        padding: '0.75rem',
                                        borderRadius: '9999px',
                                        fontWeight: '600',
                                        fontSize: '1rem',
                                        border: 'none',
                                        cursor: 'pointer',
                                        transition: 'all 300ms'
                                    }}
                                >
                                    Pay $29 to Unlock Build
                                </motion.button>
                            </form>
                            <motion.button
                                whileHover={{scale: 1.05}}
                                whileTap={{scale: 0.95}}
                                style={{
                                    marginTop: '1rem',
                                    width: '100%',
                                    backgroundColor: '#e2e8f0',
                                    color: '#4a5568',
                                    padding: '0.75rem',
                                    borderRadius: '9999px',
                                    fontWeight: '600',
                                    fontSize: '1rem',
                                    border: 'none',
                                    cursor: 'pointer',
                                    transition: 'all 300ms'
                                }}
                                onClick={() => setShowPaymentModal(false)}
                            >
                                Close
                            </motion.button>
                        </motion.div>
                    </motion.div>
                )}

                {showProfileModal && (
                    <motion.div
                        initial={{opacity: 0}}
                        animate={{opacity: 1}}
                        exit={{opacity: 0}}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 50,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0, 0, 0, 0.5)'
                        }}
                    >
                        <motion.div
                            initial={{y: -50, opacity: 0}}
                            animate={{y: 0, opacity: 1}}
                            exit={{y: -50, opacity: 0}}
                            style={{
                                backgroundColor: 'white',
                                borderRadius: '1rem',
                                padding: '2rem',
                                maxWidth: '28rem',
                                width: '100%',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                            }}
                        >
                            <h2
                                style={{
                                    fontSize: '1.5rem',
                                    fontWeight: '700',
                                    marginBottom: '1rem',
                                    color: '#1a202c'
                                }}
                            >Pay to Unlock</h2>
                            <form
                                onSubmit={handleAddFunds}
                                style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}
                            >
                                <motion.button
                                    whileHover={{scale: 1.05}}
                                    whileTap={{scale: 0.95}}
                                    type="submit"
                                    style={{
                                        width: '100%',
                                        backgroundColor: '#3b82f6',
                                        color: 'white',
                                        padding: '0.75rem',
                                        borderRadius: '9999px',
                                        fontWeight: '600',
                                        fontSize: '1rem',
                                        border: 'none',
                                        cursor: 'pointer',
                                        transition: 'all 300ms'
                                    }}
                                >
                                    Pay $29 to Unlock Build
                                </motion.button>
                            </form>
                            <motion.button
                                whileHover={{scale: 1.05}}
                                whileTap={{scale: 0.95}}
                                style={{
                                    marginTop: '1rem',
                                    width: '100%',
                                    backgroundColor: '#e2e8f0',
                                    color: '#4a5568',
                                    padding: '0.75rem',
                                    borderRadius: '9999px',
                                    fontWeight: '600',
                                    fontSize: '1rem',
                                    border: 'none',
                                    cursor: 'pointer',
                                    transition: 'all 300ms'
                                }}
                                onClick={() => setShowProfileModal(false)}
                            >
                                Close
                            </motion.button>
                        </motion.div>
                    </motion.div>
                )}

                {showAuthModal && (
                    <motion.div
                        initial={{opacity: 0}}
                        animate={{opacity: 1}}
                        exit={{opacity: 0}}
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 50,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(0, 0, 0, 0.5)'
                        }}
                    >
                        <motion.div
                            initial={{y: -50, opacity: 0}}
                            animate={{y: 0, opacity: 1}}
                            exit={{y: -50, opacity: 0}}
                            style={{
                                backgroundColor: 'white',
                                borderRadius: '1rem',
                                padding: '2rem',
                                maxWidth: '28rem',
                                width: '100%',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
                            }}
                        >
                            {showRegisterForm ? (
                                <form
                                    onSubmit={handleRegister}
                                    style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}
                                >
                                    <h2
                                        style={{
                                            fontSize: '1.5rem',
                                            fontWeight: '700',
                                            marginBottom: '1rem',
                                            color: '#1a202c'
                                        }}
                                    >Register</h2>
                                    <input
                                        type="text"
                                        name="username"
                                        placeholder="Username"
                                        required
                                        style={{
                                            width: '100%',
                                            padding: '0.75rem',
                                            backgroundColor: '#f7fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '0.375rem',
                                            fontSize: '1rem',
                                            color: '#4a5568'
                                        }}
                                    />
                                    <input
                                        type="password"
                                        name="password"
                                        placeholder="Password"
                                        required
                                        style={{
                                            width: '100%',
                                            padding: '0.75rem',
                                            backgroundColor: '#f7fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '0.375rem',
                                            fontSize: '1rem',
                                            color: '#4a5568'
                                        }}
                                    />
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}
                                    >
                                        <motion.button
                                            whileHover={{scale: 1.05}}
                                            whileTap={{scale: 0.95}}
                                            type="submit"
                                            style={{
                                                backgroundColor: '#3b82f6',
                                                color: 'white',
                                                padding: '0.75rem 1rem',
                                                borderRadius: '9999px',
                                                fontWeight: '600',
                                                fontSize: '1rem',
                                                border: 'none',
                                                cursor: 'pointer',
                                                transition: 'all 300ms'
                                            }}
                                        >
                                            Register
                                        </motion.button>
                                        <button
                                            type="button"
                                            onClick={() => setShowRegisterForm(false)}
                                            style={{
                                                backgroundColor: 'transparent',
                                                color: '#3b82f6',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontSize: '1rem'
                                            }}
                                        >
                                            Login instead
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <form
                                    onSubmit={handleLogin}
                                    style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}
                                >
                                    <h2
                                        style={{
                                            fontSize: '1.5rem',
                                            fontWeight: '700',
                                            marginBottom: '1rem',
                                            color: '#1a202c'
                                        }}
                                    >Login</h2>
                                    <input
                                        type="text"
                                        name="username"
                                        placeholder="Username"
                                        required
                                        style={{
                                            width: '100%',
                                            padding: '0.75rem',
                                            backgroundColor: '#f7fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '0.375rem',
                                            fontSize: '1rem',
                                            color: '#4a5568'
                                        }}
                                    />
                                    <input
                                        type="password"
                                        name="password"
                                        placeholder="Password"
                                        required
                                        style={{
                                            width: '100%',
                                            padding: '0.75rem',
                                            backgroundColor: '#f7fafc',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '0.375rem',
                                            fontSize: '1rem',
                                            color: '#4a5568'
                                        }}
                                    />
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                        }}
                                    >
                                        <motion.button
                                            whileHover={{scale: 1.05}}
                                            whileTap={{scale: 0.95}}
                                            type="submit"
                                            style={{
                                                backgroundColor: '#3b82f6',
                                                color: 'white',
                                                padding: '0.75rem 1rem',
                                                borderRadius: '9999px',
                                                fontWeight: '600',
                                                fontSize: '1rem',
                                                border: 'none',
                                                cursor: 'pointer',
                                                transition: 'all 300ms'
                                            }}
                                        >
                                            Login
                                        </motion.button>
                                        <button
                                            type="button"
                                            onClick={() => setShowRegisterForm(true)}
                                            style={{
                                                backgroundColor: 'transparent',
                                                color: '#3b82f6',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontSize: '1rem'
                                            }}
                                        >
                                            Register instead
                                        </button>
                                    </div>
                                </form>
                            )}
                            <motion.button
                                whileHover={{scale: 1.05}}
                                whileTap={{scale: 0.95}}
                                style={{
                                    marginTop: '1.5rem',
                                    width: '100%',
                                    backgroundColor: '#e2e8f0',
                                    color: '#4a5568',
                                    padding: '0.75rem',
                                    borderRadius: '9999px',
                                    fontWeight: '600',
                                    fontSize: '1rem',
                                    border: 'none',
                                    cursor: 'pointer',
                                    transition: 'all 300ms'
                                }}
                                onClick={() => setShowAuthModal(false)}
                            >
                                Close
                            </motion.button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default ProjectDetailsPage;
